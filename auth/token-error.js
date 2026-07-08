const SECRET_VALUE_ERROR_CODE = 'AADSTS7000215';

function formatTokenEndpointError(responseBody, fallbackMessage) {
  const rawMessage =
    responseBody && responseBody.error_description
      ? responseBody.error_description
      : fallbackMessage;

  if (!rawMessage || !rawMessage.includes(SECRET_VALUE_ERROR_CODE)) {
    return rawMessage;
  }

  return [
    'Authentication failed: Invalid client secret.',
    '',
    'Common cause: You may have copied the Secret ID instead of the Secret Value.',
    'Go to Azure Portal > App registrations > your app > Certificates & secrets',
    'and copy the text in the "Value" column, not "Secret ID".',
    '',
    `Azure error: ${rawMessage}`,
  ].join('\n');
}

module.exports = {
  formatTokenEndpointError,
};
