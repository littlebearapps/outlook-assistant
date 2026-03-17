const https = require('https');
const { EventEmitter } = require('events');
const config = require('../../config');
const mockData = require('../../utils/mock-data');

jest.mock('https');

// Save original config values
const originalTestMode = config.USE_TEST_MODE;
const originalEndpoint = config.GRAPH_API_ENDPOINT;

// We need to re-require after mocking https
let callGraphAPI, callGraphAPIPaginated, callGraphAPIBatch, callGraphAPIRaw;

beforeAll(() => {
  config.GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/';
  ({
    callGraphAPI,
    callGraphAPIPaginated,
    callGraphAPIBatch,
    callGraphAPIRaw,
  } = require('../../utils/graph-api'));
});

afterAll(() => {
  config.USE_TEST_MODE = originalTestMode;
  config.GRAPH_API_ENDPOINT = originalEndpoint;
});

/**
 * Helper to mock https.request with a given status code and response body.
 */
function mockHttpsRequest(statusCode, body, { networkError = null } = {}) {
  const mockReq = new EventEmitter();
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  https.request.mockImplementation((_url, _options, callback) => {
    if (networkError) {
      process.nextTick(() => mockReq.emit('error', networkError));
      return mockReq;
    }

    const mockRes = new EventEmitter();
    mockRes.statusCode = statusCode;
    mockRes.setEncoding = jest.fn();

    process.nextTick(() => {
      callback(mockRes);
      const responseStr =
        typeof body === 'string' ? body : JSON.stringify(body);
      mockRes.emit('data', responseStr);
      mockRes.emit('end');
    });

    return mockReq;
  });

  return mockReq;
}

describe('callGraphAPI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
  });

  describe('test mode', () => {
    it('should return mock data when USE_TEST_MODE is true and token starts with test_access_token_', async () => {
      config.USE_TEST_MODE = true;
      const spy = jest
        .spyOn(mockData, 'simulateGraphAPIResponse')
        .mockReturnValue({ value: [] });

      const result = await callGraphAPI(
        'test_access_token_abc',
        'GET',
        'me/messages'
      );

      expect(spy).toHaveBeenCalledWith('GET', 'me/messages', null, {});
      expect(result).toEqual({ value: [] });
      spy.mockRestore();
    });

    it('should make real API call even in test mode if token does not start with test_access_token_', async () => {
      config.USE_TEST_MODE = true;
      mockHttpsRequest(200, { value: ['real'] });

      const result = await callGraphAPI('real_token', 'GET', 'me/messages');
      expect(result).toEqual({ value: ['real'] });
    });
  });

  describe('URL building', () => {
    it('should build URL from path and endpoint', async () => {
      mockHttpsRequest(200, { id: '1' });

      await callGraphAPI('token', 'GET', 'me/messages');

      expect(https.request).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/messages',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should encode path segments', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI(
        'token',
        'GET',
        'me/mailFolders/Inbox & Stuff/messages'
      );

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toContain('Inbox%20%26%20Stuff');
    });

    it('should use full URL directly when path starts with https://', async () => {
      const nextLink =
        'https://graph.microsoft.com/v1.0/me/messages?$skip=10&$top=10';
      mockHttpsRequest(200, { value: [] });

      await callGraphAPI('token', 'GET', nextLink);

      expect(https.request).toHaveBeenCalledWith(
        nextLink,
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should use full URL directly when path starts with http://', async () => {
      const httpLink = 'http://localhost/test';
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', httpLink);

      expect(https.request).toHaveBeenCalledWith(
        httpLink,
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('query parameters', () => {
    it('should append query parameters to URL', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', 'me/messages', null, {
        $top: '10',
        $orderby: 'receivedDateTime desc',
      });

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toContain('?');
      expect(calledUrl).toContain('%24top=10');
      expect(calledUrl).toContain('%24orderby=receivedDateTime+desc');
    });

    it('should handle $filter parameter with separate encoding', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', 'me/messages', null, {
        $top: '10',
        $filter: 'isRead eq false',
      });

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toContain('$filter=isRead%20eq%20false');
    });

    it('should handle $filter as only query parameter', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', 'me/messages', null, {
        $filter: "subject eq 'Test'",
      });

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toContain('?$filter=');
    });

    it('should not append query string when no params', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', 'me/messages');

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toBe('https://graph.microsoft.com/v1.0/me/messages');
    });
  });

  describe('request headers', () => {
    it('should set Authorization and Content-Type headers', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('my_token_123', 'GET', 'me/messages');

      const options = https.request.mock.calls[0][1];
      expect(options.headers.Authorization).toBe('Bearer my_token_123');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('should set the correct HTTP method', async () => {
      mockHttpsRequest(200, {});

      await callGraphAPI('token', 'PATCH', 'me/messages/123', { isRead: true });

      const options = https.request.mock.calls[0][1];
      expect(options.method).toBe('PATCH');
    });
  });

  describe('request body', () => {
    it('should write JSON body for POST requests', async () => {
      const mockReq = mockHttpsRequest(200, {});
      const data = { subject: 'Test', body: { content: 'Hello' } };

      await callGraphAPI('token', 'POST', 'me/sendMail', data);

      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should write JSON body for PATCH requests', async () => {
      const mockReq = mockHttpsRequest(200, {});
      const data = { isRead: true };

      await callGraphAPI('token', 'PATCH', 'me/messages/123', data);

      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should write JSON body for PUT requests', async () => {
      const mockReq = mockHttpsRequest(200, {});
      const data = { displayName: 'New Name' };

      await callGraphAPI('token', 'PUT', 'me/contacts/123', data);

      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should not write body for GET requests', async () => {
      const mockReq = mockHttpsRequest(200, {});

      await callGraphAPI('token', 'GET', 'me/messages');

      expect(mockReq.write).not.toHaveBeenCalled();
    });

    it('should not write body for DELETE requests', async () => {
      const mockReq = mockHttpsRequest(200, {});

      await callGraphAPI('token', 'DELETE', 'me/messages/123');

      expect(mockReq.write).not.toHaveBeenCalled();
    });
  });

  describe('response handling', () => {
    it('should parse JSON response on success (200)', async () => {
      mockHttpsRequest(200, { value: [{ id: '1' }] });

      const result = await callGraphAPI('token', 'GET', 'me/messages');

      expect(result).toEqual({ value: [{ id: '1' }] });
    });

    it('should handle 204 No Content with empty body', async () => {
      mockHttpsRequest(204, '');

      const result = await callGraphAPI('token', 'DELETE', 'me/messages/123');

      expect(result).toEqual({});
    });

    it('should reject with UNAUTHORIZED on 401', async () => {
      mockHttpsRequest(401, 'Unauthorized');

      await expect(
        callGraphAPI('bad_token', 'GET', 'me/messages')
      ).rejects.toThrow('UNAUTHORIZED');
    });

    it('should reject with status and body on 400', async () => {
      mockHttpsRequest(400, '{"error":{"message":"Bad Request"}}');

      await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
        'API call failed with status 400'
      );
    });

    it('should reject with status and body on 500', async () => {
      mockHttpsRequest(500, 'Internal Server Error');

      await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
        'API call failed with status 500'
      );
    });

    it('should reject on JSON parse error', async () => {
      mockHttpsRequest(200, 'not-json{{{');

      await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
        'Error parsing API response'
      );
    });
  });

  describe('network errors', () => {
    it('should reject with network error message', async () => {
      mockHttpsRequest(200, '', { networkError: new Error('ECONNREFUSED') });

      await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
        'Network error during API call: ECONNREFUSED'
      );
    });
  });
});

describe('callGraphAPIPaginated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
  });

  it('should reject non-GET requests', async () => {
    await expect(
      callGraphAPIPaginated('token', 'POST', 'me/messages')
    ).rejects.toThrow('Pagination only supports GET requests');
  });

  it('should return items from a single page (no nextLink)', async () => {
    const items = [{ id: '1' }, { id: '2' }];
    mockHttpsRequest(200, { value: items });

    const result = await callGraphAPIPaginated('token', 'GET', 'me/messages');

    expect(result.value).toEqual(items);
    expect(result['@odata.count']).toBe(2);
  });

  it('should follow nextLink for multiple pages', async () => {
    const page1 = {
      value: [{ id: '1' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=1',
    };
    const page2 = { value: [{ id: '2' }] };

    let callCount = 0;
    https.request.mockImplementation((_url, _options, callback) => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter();
      mockRes.statusCode = 200;

      process.nextTick(() => {
        callback(mockRes);
        const data = callCount === 0 ? page1 : page2;
        callCount++;
        mockRes.emit('data', JSON.stringify(data));
        mockRes.emit('end');
      });

      return mockReq;
    });

    const result = await callGraphAPIPaginated('token', 'GET', 'me/messages');

    expect(result.value).toEqual([{ id: '1' }, { id: '2' }]);
    expect(result['@odata.count']).toBe(2);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it('should stop pagination when maxCount is reached', async () => {
    const page1 = {
      value: [{ id: '1' }, { id: '2' }, { id: '3' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=3',
    };

    mockHttpsRequest(200, page1);

    const result = await callGraphAPIPaginated(
      'token',
      'GET',
      'me/messages',
      {},
      2
    );

    expect(result.value).toHaveLength(2);
    expect(result.value).toEqual([{ id: '1' }, { id: '2' }]);
    // Should not follow nextLink since maxCount reached
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('should trim results to exact maxCount', async () => {
    mockHttpsRequest(200, { value: [{ id: '1' }, { id: '2' }, { id: '3' }] });

    const result = await callGraphAPIPaginated(
      'token',
      'GET',
      'me/messages',
      {},
      2
    );

    expect(result.value).toHaveLength(2);
    expect(result['@odata.count']).toBe(2);
  });

  it('should return all items when maxCount is 0', async () => {
    mockHttpsRequest(200, { value: [{ id: '1' }, { id: '2' }, { id: '3' }] });

    const result = await callGraphAPIPaginated(
      'token',
      'GET',
      'me/messages',
      {},
      0
    );

    expect(result.value).toHaveLength(3);
  });

  it('should handle empty response value', async () => {
    mockHttpsRequest(200, { value: [] });

    const result = await callGraphAPIPaginated('token', 'GET', 'me/messages');

    expect(result.value).toEqual([]);
    expect(result['@odata.count']).toBe(0);
  });

  it('should handle response without value array', async () => {
    mockHttpsRequest(200, { someOtherField: 'data' });

    const result = await callGraphAPIPaginated('token', 'GET', 'me/messages');

    expect(result.value).toEqual([]);
  });

  it('should propagate errors from callGraphAPI', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    mockHttpsRequest(401, 'Unauthorized');

    await expect(
      callGraphAPIPaginated('bad_token', 'GET', 'me/messages')
    ).rejects.toThrow('UNAUTHORIZED');

    console.error.mockRestore();
  });
});

describe('callGraphAPIRaw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
  });

  describe('test mode', () => {
    it('should return mock MIME content when getMockMimeContent exists', async () => {
      config.USE_TEST_MODE = true;
      const original = mockData.getMockMimeContent;
      mockData.getMockMimeContent = jest
        .fn()
        .mockReturnValue('MIME-Version: 1.0\n\nMock content');

      const result = await callGraphAPIRaw('test_access_token_abc', 'msg-123');

      expect(result).toBe('MIME-Version: 1.0\n\nMock content');
      expect(mockData.getMockMimeContent).toHaveBeenCalledWith('msg-123');

      mockData.getMockMimeContent = original;
    });

    it('should return fallback MIME content when getMockMimeContent does not exist', async () => {
      config.USE_TEST_MODE = true;
      const original = mockData.getMockMimeContent;
      mockData.getMockMimeContent = undefined;

      const result = await callGraphAPIRaw('test_access_token_abc', 'msg-456');

      expect(result).toContain('MIME-Version: 1.0');
      expect(result).toContain('msg-456');

      mockData.getMockMimeContent = original;
    });
  });

  describe('real API call', () => {
    it('should return raw MIME string on success', async () => {
      const mimeContent =
        'MIME-Version: 1.0\nContent-Type: text/plain\n\nHello';
      mockHttpsRequest(200, mimeContent);

      const result = await callGraphAPIRaw('token', 'email-123');

      expect(result).toBe(mimeContent);
    });

    it('should build correct URL with encoded email ID', async () => {
      mockHttpsRequest(200, 'content');

      await callGraphAPIRaw('token', 'AAMk=123+test');

      const calledUrl = https.request.mock.calls[0][0];
      expect(calledUrl).toContain('me/messages/');
      expect(calledUrl).toContain('/$value');
    });

    it('should set Accept header to message/rfc822', async () => {
      mockHttpsRequest(200, 'content');

      await callGraphAPIRaw('token', 'email-123');

      const options = https.request.mock.calls[0][1];
      expect(options.headers.Accept).toBe('message/rfc822');
      expect(options.method).toBe('GET');
    });

    it('should reject with UNAUTHORIZED on 401', async () => {
      mockHttpsRequest(401, 'Unauthorized');

      await expect(callGraphAPIRaw('bad_token', 'email-123')).rejects.toThrow(
        'UNAUTHORIZED'
      );
    });

    it('should reject with truncated body on non-success status', async () => {
      mockHttpsRequest(404, 'Not Found');

      await expect(callGraphAPIRaw('token', 'email-123')).rejects.toThrow(
        'MIME export failed with status 404'
      );
    });

    it('should reject on network error', async () => {
      mockHttpsRequest(200, '', { networkError: new Error('ETIMEDOUT') });

      await expect(callGraphAPIRaw('token', 'email-123')).rejects.toThrow(
        'Network error during MIME export: ETIMEDOUT'
      );
    });
  });
});

describe('callGraphAPIBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
  });

  it('should reject empty requests array', async () => {
    await expect(callGraphAPIBatch('token', [])).rejects.toThrow(
      'non-empty array'
    );
  });

  it('should reject non-array requests', async () => {
    await expect(callGraphAPIBatch('token', null)).rejects.toThrow(
      'non-empty array'
    );
  });

  it('should reject more than 20 requests', async () => {
    const requests = Array.from({ length: 21 }, (_, i) => ({
      id: String(i),
      method: 'GET',
      url: '/me/messages',
    }));

    await expect(callGraphAPIBatch('token', requests)).rejects.toThrow(
      'cannot exceed 20'
    );
  });

  it('should send batch request with correct payload', async () => {
    const batchResponse = {
      responses: [
        { id: '1', status: 200, body: { value: [{ id: 'msg1' }] } },
        { id: '2', status: 200, body: { value: [{ id: 'msg2' }] } },
      ],
    };
    mockHttpsRequest(200, batchResponse);

    const requests = [
      { id: '1', method: 'GET', url: '/me/messages/msg1' },
      { id: '2', method: 'GET', url: '/me/messages/msg2' },
    ];

    const result = await callGraphAPIBatch('token', requests);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');

    // Verify the URL targets $batch endpoint
    const calledUrl = https.request.mock.calls[0][0];
    expect(calledUrl).toContain('%24batch');
  });

  it('should sort responses by ID', async () => {
    const batchResponse = {
      responses: [
        { id: '2', status: 200, body: {} },
        { id: '1', status: 200, body: {} },
      ],
    };
    mockHttpsRequest(200, batchResponse);

    const result = await callGraphAPIBatch('token', [
      { id: '1', method: 'GET', url: '/me/messages/1' },
      { id: '2', method: 'GET', url: '/me/messages/2' },
    ]);

    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('should prepend / to urls that do not start with /', async () => {
    mockHttpsRequest(200, { responses: [] });

    const mockReq = https.request.mock;

    await callGraphAPIBatch('token', [
      { id: '1', method: 'GET', url: 'me/messages/1' },
    ]);

    // The body written should contain /me/messages/1
    const writtenBody = mockReq.results[0].value.write.mock.calls[0][0];
    const parsed = JSON.parse(writtenBody);
    expect(parsed.requests[0].url).toBe('/me/messages/1');
  });

  it('should include body and headers when provided', async () => {
    mockHttpsRequest(200, { responses: [] });

    await callGraphAPIBatch('token', [
      {
        id: '1',
        method: 'POST',
        url: '/me/sendMail',
        body: { message: { subject: 'Test' } },
        headers: { 'Content-Type': 'application/json' },
      },
    ]);

    const writtenBody =
      https.request.mock.results[0].value.write.mock.calls[0][0];
    const parsed = JSON.parse(writtenBody);
    expect(parsed.requests[0].body).toEqual({
      message: { subject: 'Test' },
    });
    expect(parsed.requests[0].headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('should return mock responses in test mode', async () => {
    config.USE_TEST_MODE = true;
    const spy = jest
      .spyOn(mockData, 'simulateGraphAPIResponse')
      .mockReturnValue({ value: [] });

    const result = await callGraphAPIBatch('test_access_token_abc', [
      { id: '1', method: 'GET', url: '/me/messages' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].status).toBe(200);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('callGraphAPI - immutable IDs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
    config.USE_IMMUTABLE_IDS = false;
  });

  afterEach(() => {
    config.USE_IMMUTABLE_IDS = false;
  });

  it('should not include Prefer header when USE_IMMUTABLE_IDS is false', async () => {
    mockHttpsRequest(200, {});

    await callGraphAPI('token', 'GET', 'me/messages');

    const options = https.request.mock.calls[0][1];
    expect(options.headers.Prefer).toBeUndefined();
  });

  it('should include Prefer header when USE_IMMUTABLE_IDS is true', async () => {
    config.USE_IMMUTABLE_IDS = true;
    mockHttpsRequest(200, {});

    await callGraphAPI('token', 'GET', 'me/messages');

    const options = https.request.mock.calls[0][1];
    expect(options.headers.Prefer).toBe('IdType="ImmutableId"');
  });

  it('should allow extraHeaders to override Prefer', async () => {
    config.USE_IMMUTABLE_IDS = true;
    mockHttpsRequest(200, {});

    await callGraphAPI(
      'token',
      'GET',
      'me/messages',
      null,
      {},
      {
        Prefer: 'outlook.body-content-type="text"',
      }
    );

    const options = https.request.mock.calls[0][1];
    expect(options.headers.Prefer).toBe('outlook.body-content-type="text"');
  });

  it('should merge extraHeaders with default headers', async () => {
    mockHttpsRequest(200, {});

    await callGraphAPI(
      'token',
      'GET',
      'me/messages',
      null,
      {},
      {
        'X-Custom': 'value',
      }
    );

    const options = https.request.mock.calls[0][1];
    expect(options.headers['X-Custom']).toBe('value');
    expect(options.headers.Authorization).toBe('Bearer token');
  });
});
