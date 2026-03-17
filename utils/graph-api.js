/**
 * Microsoft Graph API helper functions
 */
const https = require('https');
const config = require('../config');
const mockData = require('./mock-data');

/**
 * Makes a request to the Microsoft Graph API
 * In test mode (USE_TEST_MODE=true), routes to mock data instead of the real API.
 * @param {string} accessToken - The access token for authentication
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API endpoint path
 * @param {object} data - Data to send for POST/PUT requests
 * @param {object} queryParams - Query parameters
 * @returns {Promise<object>} - The API response
 * @throws {Error} 'UNAUTHORIZED' if the server returns HTTP 401 (token expired or invalid)
 * @throws {Error} If the HTTP status is outside 2xx, or if JSON parsing or network fails
 */
async function callGraphAPI(
  accessToken,
  method,
  path,
  data = null,
  queryParams = {}
) {
  // For test tokens, we'll simulate the API call
  if (config.USE_TEST_MODE && accessToken.startsWith('test_access_token_')) {
    return mockData.simulateGraphAPIResponse(method, path, data, queryParams);
  }

  try {
    // Check if path already contains the full URL (from nextLink)
    let finalUrl;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      // Path is already a full URL (from pagination nextLink)
      finalUrl = path;
    } else {
      // Build URL from path and queryParams
      // Encode path segments properly
      const encodedPath = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

      // Build query string from parameters with special handling for OData filters
      let queryString = '';
      if (Object.keys(queryParams).length > 0) {
        // Handle $filter parameter specially to ensure proper URI encoding
        const filter = queryParams.$filter;
        if (filter) {
          delete queryParams.$filter; // Remove from regular params
        }

        // Build query string with proper encoding for regular params
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(queryParams)) {
          params.append(key, value);
        }

        queryString = params.toString();

        // Add filter parameter separately with proper encoding
        if (filter) {
          if (queryString) {
            queryString += `&$filter=${encodeURIComponent(filter)}`;
          } else {
            queryString = `$filter=${encodeURIComponent(filter)}`;
          }
        }

        if (queryString) {
          queryString = '?' + queryString;
        }
      }

      finalUrl = `${config.GRAPH_API_ENDPOINT}${encodedPath}${queryString}`;
    }

    return new Promise((resolve, reject) => {
      const options = {
        method: method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(finalUrl, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              responseData = responseData ? responseData : '{}';
              const jsonResponse = JSON.parse(responseData);
              resolve(jsonResponse);
            } catch (error) {
              reject(new Error(`Error parsing API response: ${error.message}`));
            }
          } else if (res.statusCode === 401) {
            // Token expired or invalid
            reject(new Error('UNAUTHORIZED'));
          } else {
            // Truncate response to avoid leaking sensitive data in error messages
            const safeResponse = responseData.substring(0, 200);
            reject(
              new Error(
                `API call failed with status ${res.statusCode}: ${safeResponse}`
              )
            );
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error during API call: ${error.message}`));
      });

      if (
        data &&
        (method === 'POST' || method === 'PATCH' || method === 'PUT')
      ) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  } catch (error) {
    console.error('Error calling Graph API:', error);
    throw error;
  }
}

/**
 * Calls Graph API with pagination support to retrieve all results up to maxCount
 * @param {string} accessToken - The access token for authentication
 * @param {string} method - HTTP method (GET only for pagination)
 * @param {string} path - API endpoint path
 * @param {object} queryParams - Initial query parameters
 * @param {number} maxCount - Maximum number of items to retrieve (0 = all)
 * @returns {Promise<object>} - Combined API response with all items
 * @throws {Error} If method is not 'GET'
 * @throws {Error} If any page request fails for any other reason
 */
async function callGraphAPIPaginated(
  accessToken,
  method,
  path,
  queryParams = {},
  maxCount = 0
) {
  if (method !== 'GET') {
    throw new Error('Pagination only supports GET requests');
  }

  const allItems = [];
  let nextLink;
  let currentUrl = path;
  let currentParams = { ...queryParams };

  try {
    do {
      // Make API call
      const response = await callGraphAPI(
        accessToken,
        method,
        currentUrl,
        null,
        currentParams
      );

      // Add items from this page
      if (response.value && Array.isArray(response.value)) {
        allItems.push(...response.value);
      }

      // Check if we've reached the desired count
      if (maxCount > 0 && allItems.length >= maxCount) {
        break;
      }

      // Get next page URL
      nextLink = response['@odata.nextLink'];

      if (nextLink) {
        // Pass the full nextLink URL directly to callGraphAPI
        currentUrl = nextLink;
        currentParams = {}; // nextLink already contains all params
      }
    } while (nextLink);

    // Trim to exact count if needed
    const finalItems = maxCount > 0 ? allItems.slice(0, maxCount) : allItems;

    return {
      value: finalItems,
      '@odata.count': finalItems.length,
    };
  } catch (error) {
    console.error('Error during pagination:', error);
    throw error;
  }
}

/**
 * Calls Graph API to get raw MIME content (for email export)
 * In test mode (USE_TEST_MODE=true), returns mock MIME content instead of calling the real API.
 * @param {string} accessToken - The access token for authentication
 * @param {string} emailId - The email ID to export
 * @returns {Promise<string>} - Raw MIME content as string
 * @throws {Error} 'UNAUTHORIZED' if the server returns HTTP 401 (token expired or invalid)
 * @throws {Error} If the HTTP status is outside 2xx or a network error occurs
 */
async function callGraphAPIRaw(accessToken, emailId) {
  // Test mode: return mock MIME content
  if (config.USE_TEST_MODE && accessToken.startsWith('test_access_token_')) {
    return mockData.getMockMimeContent
      ? mockData.getMockMimeContent(emailId)
      : `MIME-Version: 1.0\nContent-Type: text/plain\n\nTest email content for ${emailId}`;
  }

  return new Promise((resolve, reject) => {
    const path = `me/messages/${encodeURIComponent(emailId)}/$value`;
    const finalUrl = `${config.GRAPH_API_ENDPOINT}${path}`;

    const options = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'message/rfc822', // Request MIME format
      },
    };

    const req = https.request(finalUrl, options, (res) => {
      let responseData = '';

      // Collect data as UTF-8 string
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData);
        } else if (res.statusCode === 401) {
          reject(new Error('UNAUTHORIZED'));
        } else {
          reject(
            new Error(
              `MIME export failed with status ${res.statusCode}: ${responseData.substring(0, 200)}`
            )
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error during MIME export: ${error.message}`));
    });

    req.end();
  });
}

module.exports = {
  callGraphAPI,
  callGraphAPIPaginated,
  callGraphAPIRaw,
};
