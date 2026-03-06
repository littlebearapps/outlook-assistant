#!/usr/bin/env node
/**
 * Script to find and move existing GitHub notification emails
 * to the GitHub Notifications subfolder
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const homePath = process.env.HOME || require('os').homedir();
const tokenPath = path.join(homePath, '.outlook-assistant-tokens.json');
const githubFolderId =
  'AAMkAGQ0NzYwMTdmLTYzMWUtNDE1ZS04ZDYyLTZjZmQ5YjkyNWM0OQAuAAAAAAAMiw_uRKMyQ4cvWGcmDNGZAQD-pkus0juzTK_ueB_BlgMCAAGKmpqoAAA=';
const notificationsFolderId =
  'AAMkAGQ0NzYwMTdmLTYzMWUtNDE1ZS04ZDYyLTZjZmQ5YjkyNWM0OQAuAAAAAAAMiw_uRKMyQ4cvWGcmDNGZAQD-pkus0juzTK_ueB_BlgMCAAGKmpqpAAA=';

// Main function
async function moveGitHubEmails() {
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

    // Step 1: Search for GitHub notification emails in the inbox
    console.log('\nSearching for GitHub notification emails...');
    const searchParams = new URLSearchParams({
      $filter:
        "from/emailAddress/address eq 'notifications@github.com' or from/emailAddress/address eq 'noreply@github.com'",
      $top: 100,
      $select: 'id,subject,from,receivedDateTime',
    });

    const inboxEmails = await callGraphAPI(
      `me/mailFolders/inbox/messages?${searchParams.toString()}`
    );

    console.log(
      `Found ${inboxEmails.value.length} GitHub notification emails in inbox`
    );

    // Step 2: Classify emails as workflow notifications or other
    const workflowEmails = [];
    const otherEmails = [];

    inboxEmails.value.forEach((email) => {
      const subject = email.subject.toLowerCase();
      if (
        subject.includes('workflow') ||
        subject.includes('run failed') ||
        subject.includes('run completed') ||
        subject.includes('github actions')
      ) {
        workflowEmails.push(email);
      } else if (subject.includes('[gondola')) {
        workflowEmails.push(email); // These are also notifications
      } else {
        otherEmails.push(email);
      }
    });

    console.log(`Workflow notifications: ${workflowEmails.length}`);
    console.log(`Other GitHub emails: ${otherEmails.length}`);

    // Step 3: Move workflow notifications to the Notifications subfolder
    if (workflowEmails.length > 0) {
      console.log(
        '\nMoving workflow notifications to Notifications subfolder...'
      );

      let movedCount = 0;
      for (const email of workflowEmails) {
        try {
          await callGraphAPI(`me/messages/${email.id}/move`, 'POST', {
            destinationId: notificationsFolderId,
          });
          movedCount++;
          console.log(
            `Moved ${movedCount}/${workflowEmails.length}: "${email.subject}"`
          );
        } catch (error) {
          console.error(`Failed to move email: ${error.message}`);
        }
      }

      console.log(
        `Successfully moved ${movedCount} workflow notifications to Notifications subfolder`
      );
    }

    // Step 4: Move other GitHub emails to the main GitHub folder
    if (otherEmails.length > 0) {
      console.log('\nMoving other GitHub emails to GitHub folder...');

      let movedCount = 0;
      for (const email of otherEmails) {
        try {
          await callGraphAPI(`me/messages/${email.id}/move`, 'POST', {
            destinationId: githubFolderId,
          });
          movedCount++;
          console.log(
            `Moved ${movedCount}/${otherEmails.length}: "${email.subject}"`
          );
        } catch (error) {
          console.error(`Failed to move email: ${error.message}`);
        }
      }

      console.log(
        `Successfully moved ${movedCount} other GitHub emails to GitHub folder`
      );
    }

    console.log('\nEmail organization complete!');
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
            const jsonResponse = responseData ? JSON.parse(responseData) : {};
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
moveGitHubEmails();
