/**
 * Netlify Function – POST /api/delete-client
 * Removes a client from the salon, on Moriya's request from the dashboard.
 *
 * Body: { clientId, accessToken }
 *
 * The work itself lives in shared/delete-client.js, so this endpoint and the
 * local dev server (server/server.js) behave identically. See that file for why
 * the auth user is deleted rather than just the profile row.
 */
const { deleteClient } = require('../../shared/delete-client');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { status, body: payload } = await deleteClient({
    clientId:    body.clientId,
    accessToken: body.accessToken,
  });
  return { statusCode: status, headers, body: JSON.stringify(payload) };
};
