import express from 'express';
import { Octokit } from '@octokit/rest';
import 'dotenv/config'; // Used to load environment variables from .env
// You must install 'cors' via: npm install cors
import cors from 'cors'; 

// --- Environment Variables ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_REPO = process.env.GITHUB_REPO;

// --- Setup ---
const app = express();
const port = 4000;

app.use(cors()); 

app.use(express.json());

let octokit;
if (GITHUB_TOKEN) {
    octokit = new Octokit({ auth: GITHUB_TOKEN });
} else {
    console.error("FATAL: GITHUB_TOKEN environment variable is not set.");
}


/**
 * Commits the new content to the specified file in the GitHub repository.
 * @param {string} content The content (HTML) to commit.
 * @param {string} message The commit message.
 * @returns {Promise<void>}
 */
async function commitFile(content, message) {
    const owner = GITHUB_USERNAME;
    const repo = GITHUB_REPO;
    const path = 'www/index.html'; // Standard Capacitor web asset path

    // 1. Get the current file SHA (required for updating)
    let sha = null;
    try {
        const { data: fileData } = await octokit.repos.getContent({ owner, repo, path });
        sha = fileData.sha;
    } catch (error) {
        // If the file doesn't exist, we ignore the error and create a new one (sha remains null)
        if (error.status !== 404) {
            console.error(`Error fetching file SHA for ${path}:`, error.message);
            throw new Error('Could not fetch file history from GitHub.');
        }
    }

    // 2. Commit the new content
    const base64Content = Buffer.from(content).toString('base64');
    const commitParams = {
        owner,
        repo,
        path,
        message,
        content: base64Content,
        sha: sha || undefined, // Provide SHA if updating, omit if creating new file
        branch: 'main', // Assuming 'main' branch
    };

    await octokit.repos.createOrUpdateFileContents(commitParams);
}

/**
 * Triggers the GitHub Actions workflow dispatch event.
 * @returns {Promise<string>} The URL of the triggered workflow run.
 */
async function triggerWorkflow() {
    const owner = GITHUB_USERNAME;
    const repo = GITHUB_REPO;
    const workflow_id = 'build.yml'; // The name of the workflow file

    await octokit.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id,
        ref: 'main', // Branch to run the workflow on
        // You can pass inputs here if needed, but not required for this minimal setup
    });

    // In a real scenario, getting the *specific* workflow run URL immediately is complex.
    // For this prototype, we return a link to the Actions page.
    return `https://github.com/${owner}/${repo}/actions`;
    // A more advanced approach would involve polling the list of runs for a recent one.
}


// --- API Endpoint ---

app.post('/generate', async (req, res) => {
    if (!octokit) {
        return res.status(500).json({ error: 'GitHub client not initialized. Check GITHUB_TOKEN.' });
    }
    if (!GITHUB_USERNAME || !GITHUB_REPO) {
        return res.status(500).json({ error: 'Missing GITHUB_USERNAME or GITHUB_REPO env vars.' });
    }

    const { type, content } = req.body;

    // 1. Determine Content Source and Fetch/Use Content
    let fileContent = '';
    const commitMessage = `Automated build trigger: ${type === 'url' ? 'URL' : 'HTML'} update.`;

    if (type === 'url') {
        try {
            // NOTE: In a real environment, you'd use a library like 'node-fetch' to download the content.
            // Here, we simulate fetching the HTML content from the URL.
            console.log(`[SIMULATION] Fetching content from URL: ${content}`);
            // For the prototype, we assume fetching is successful and return a simple placeholder HTML.
            fileContent = `<!DOCTYPE html><html><head><title>App from URL</title></head><body><h1>Content from: ${content}</h1><p>This content was dynamically fetched and built into the IPA.</p></body></html>`;
        } catch (fetchError) {
            return res.status(400).json({ error: `Could not fetch content from URL: ${fetchError.message}` });
        }
    } else if (type === 'html') {
        fileContent = content;
    } else {
        return res.status(400).json({ error: 'Invalid input type. Must be "html" or "url".' });
    }


    try {
        // 2. Commit the new index.html to GitHub
        await commitFile(fileContent, commitMessage);
        console.log('Successfully committed www/index.html to GitHub.');

        // 3. Trigger the GitHub Actions Workflow
        const workflowUrl = await triggerWorkflow();
        console.log('Successfully triggered GitHub Actions workflow.');

        // 4. Respond to client
        return res.json({
            message: 'Repository updated and workflow dispatched.',
            workflowUrl: workflowUrl,
        });

    } catch (githubError) {
        console.error('GitHub operation failed:', githubError.message);
        return res.status(500).json({ error: `GitHub API Error: ${githubError.message}. Check token scope and repo path.` });
    }
});

// --- Server Startup ---
app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log('--- IMPORTANT: ENVIRONMENT VARIABLES REQUIRED ---');
    console.log(`GITHUB_USERNAME: ${GITHUB_USERNAME}`);
    console.log(`GITHUB_REPO: ${GITHUB_REPO}`);
    console.log(`GITHUB_TOKEN (Set): ${!!GITHUB_TOKEN}`);
    console.log('--------------------------------------------------');
});
