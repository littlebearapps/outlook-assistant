#!/usr/bin/env node
/**
 * Script to find folder IDs for GitHub and Notifications folders
 * This helps create rules that target specific folders
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const homePath = process.env.HOME || require('os').homedir();
const tokenPath = path.join(homePath, '.outlook-assistant-tokens.json');

// Main function
async function findFolderIds() {
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

    // Step 1: Get the list of folders
    console.log('\nFetching top-level folders...');
    const folders = await callGraphAPI('me/mailFolders?$top=100');

    // Print all folders and their IDs for reference
    console.log('\nAll top-level folders:');
    folders.value.forEach((folder) => {
      console.log(`${folder.displayName}: ${folder.id}`);
    });

    // Step 2: Find the GitHub folder specifically
    const githubFolder = folders.value.find(
      (f) =>
        f.displayName === 'GitHub' || f.displayName.toLowerCase() === 'github'
    );

    if (!githubFolder) {
      console.error('\nGitHub folder not found!');
      process.exit(1);
    }

    console.log(`\nFound GitHub folder: ${githubFolder.displayName}`);
    console.log(`ID: ${githubFolder.id}`);

    // Step 3: Get child folders of GitHub
    console.log('\nFetching GitHub child folders...');
    const childFolders = await callGraphAPI(
      `me/mailFolders/${githubFolder.id}/childFolders`
    );

    // Print all child folders
    console.log('\nChild folders of GitHub:');
    if (childFolders.value && childFolders.value.length > 0) {
      childFolders.value.forEach((folder) => {
        console.log(`${folder.displayName}: ${folder.id}`);
      });

      // Step 4: Find the Notifications subfolder
      const notificationsFolder = childFolders.value.find(
        (f) =>
          f.displayName === 'Notifications' ||
          f.displayName.toLowerCase() === 'notifications'
      );

      if (notificationsFolder) {
        console.log(
          `\nFound Notifications subfolder: ${notificationsFolder.displayName}`
        );
        console.log(`ID: ${notificationsFolder.id}`);

        // Final output for easy reference
        console.log('\n===== FOLDER IDs FOR RULES =====');
        console.log(`GitHub folder: ${githubFolder.id}`);
        console.log(`Notifications subfolder: ${notificationsFolder.id}`);
        console.log('===============================');
      } else {
        console.log('\nNotifications subfolder not found in GitHub folder');
      }
    } else {
      console.log('No child folders found in GitHub folder');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Helper function to call Microsoft Graph API
 */
async function callGraphAPI(endpoint) {
  return new Promise((resolve, reject) => {
    // Read token from file again to ensure it's fresh
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const accessToken = tokenData.access_token;

    const options = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/${endpoint}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonResponse = JSON.parse(data);
            resolve(jsonResponse);
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        } else {
          reject(
            new Error(
              `API request failed with status ${res.statusCode}: ${data}`
            )
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    req.end();
  });
}

// Run the script
findFolderIds();
