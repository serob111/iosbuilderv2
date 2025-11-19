import express from 'express';
import { Octokit } from '@octokit/rest';
import 'dotenv/config';
import cors from 'cors';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_REPO = process.env.GITHUB_REPO;

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
    const path = 'www/index.html';


    let sha = null;
    try {
        const { data: fileData } = await octokit.repos.getContent({ owner, repo, path });
        sha = fileData.sha;
    } catch (error) {
        if (error.status !== 404) {
            console.error(`Error fetching file SHA for ${path}:`, error.message);
            throw new Error('Could not fetch file history from GitHub.');
        }
    }

    const base64Content = Buffer.from(content).toString('base64');
    const commitParams = {
        owner,
        repo,
        path,
        message,
        content: base64Content,
        sha: sha || undefined,
        branch: 'main',
    };

    await octokit.repos.createOrUpdateFileContents(commitParams);
}

/**
 * Triggers the GitHub Actions workflow dispatch event.
 * @returns {Promise<string>}
 */
async function triggerWorkflow() {
    const owner = GITHUB_USERNAME;
    const repo = GITHUB_REPO;
    const workflow_id = 'build.yml';

    await octokit.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id,
        ref: 'main',
    });


    return `https://github.com/${owner}/${repo}/actions`;
}



app.post('/generate', async (req, res) => {
    if (!octokit) {
        return res.status(500).json({ error: 'GitHub client not initialized. Check GITHUB_TOKEN.' });
    }
    if (!GITHUB_USERNAME || !GITHUB_REPO) {
        return res.status(500).json({ error: 'Missing GITHUB_USERNAME or GITHUB_REPO env vars.' });
    }

    const { type, content } = req.body;

    let fileContent = '';
    const commitMessage = `Automated build trigger: ${type === 'url' ? 'URL' : 'HTML'} update.`;

    if (type === 'url') {
        try {
            console.log(`Generating WebView redirect for URL: ${content}`);
    
            fileContent = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>WebView</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        background: #000;
      }
    </style>
    </head>
    <body>
    
    <script>
      // WORKS INSIDE IOS IPA
      window.location.href = "${content}";
    </script>
    
    </body>
    </html>`;
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    }
    
    else if (type === 'html') {
        fileContent = content;
    } else {
        return res.status(400).json({ error: 'Invalid input type. Must be "html" or "url".' });
    }


    try {
        await commitFile(fileContent, commitMessage);
        console.log('Successfully committed www/index.html to GitHub.');

        const workflowUrl = await triggerWorkflow();
        console.log('Successfully triggered GitHub Actions workflow.');

        return res.json({
            message: 'Repository updated and workflow dispatched.',
            workflowUrl: workflowUrl,
        });

    } catch (githubError) {
        console.error('GitHub operation failed:', githubError.message);
        return res.status(500).json({ error: `GitHub API Error: ${githubError.message}. Check token scope and repo path.` });
    }
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log('--- IMPORTANT: ENVIRONMENT VARIABLES REQUIRED ---');
    console.log(`GITHUB_USERNAME: ${GITHUB_USERNAME}`);
    console.log(`GITHUB_REPO: ${GITHUB_REPO}`);
    console.log(`GITHUB_TOKEN (Set): ${!!GITHUB_TOKEN}`);
    console.log('--------------------------------------------------');
});
