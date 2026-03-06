#!/usr/bin/env node
/**
 * Script to create a custom rule for GitHub notifications
 * using direct folder IDs
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const homePath = process.env.HOME || require('os').homedir();
const tokenPath = path.join(homePath, '.outlook-assistant-tokens.json');
const notificationsFolderId =
  'AAMkAGQ0NzYwMTdmLTYzMWUtNDE1ZS04ZDYyLTZjZmQ5YjkyNWM0OQAuAAAAAAAMiw_uRKMyQ4cvWGcmDNGZAQD-pkus0juzTK_ueB_BlgMCAAGKmpqpAAA=';

// Main function
async function createGitHubRule() {
  try {
    // Read the authentication token from file
    console.log(`Reading token from ${tokenPath}`);
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('No access token found in token file!');
      process.exit(1);
    }

    console.log('Successfully read access token');

    // Define the rule for GitHub notifications
    const rule = {
      displayName: 'GitHub Workflow Notifications to Subfolder',
      sequence: 1,
      isEnabled: true,
      conditions: {
        fromAddresses: [
          {
            emailAddress: {
              address: 'notifications@github.com',
            },
          },
          {
            emailAddress: {
              address: 'noreply@github.com',
            },
          },
        ],
        // This will catch GitHub workflow notifications
        subjectContains: [
          'workflow',
          'Run failed',
          'Run completed',
          'GitHub Actions',
        ],
      },
      actions: {
        moveToFolder: notificationsFolderId,
        stopProcessingRules: true,
      },
    };

    // Create the rule
    console.log('Creating GitHub notifications rule...');
    const response = await callGraphAPI(
      'me/mailFolders/inbox/messageRules',
      'POST',
      rule
    );

    console.log('\nRule created successfully:');
    console.log(`Name: ${response.displayName}`);
    console.log(`ID: ${response.id}`);
    console.log(`Sequence: ${response.sequence}`);
    console.log(`Enabled: ${response.isEnabled}`);

    // Create a second rule for repository notifications
    const repoRule = {
      displayName: 'GitHub Repository Notifications to Subfolder',
      sequence: 2,
      isEnabled: true,
      conditions: {
        fromAddresses: [
          {
            emailAddress: {
              address: 'notifications@github.com',
            },
          },
        ],
        // This catches repository notifications with format [repo-name]
        subjectContains: ['[Gondola'],
      },
      actions: {
        moveToFolder: notificationsFolderId,
        stopProcessingRules: true,
      },
    };

    console.log('\nCreating GitHub repository notifications rule...');
    const repoResponse = await callGraphAPI(
      'me/mailFolders/inbox/messageRules',
      'POST',
      repoRule
    );

    console.log('\nRepository rule created successfully:');
    console.log(`Name: ${repoResponse.displayName}`);
    console.log(`ID: ${repoResponse.id}`);
    console.log(`Sequence: ${repoResponse.sequence}`);
    console.log(`Enabled: ${repoResponse.isEnabled}`);

    console.log(
      '\nRules created successfully! Your GitHub notifications will now be moved to the Notifications subfolder.'
    );
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Helper function to call Microsoft Graph API
 */
async function callGraphAPI(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    // Read token from file again to ensure it's fresh
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const accessToken = tokenData.access_token;

    const options = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/${endpoint}`,
      method: method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonResponse = JSON.parse(responseData);
            resolve(jsonResponse);
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        } else {
          reject(
            new Error(
              `API request failed with status ${res.statusCode}: ${responseData}`
            )
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Run the script
createGitHubRule();
