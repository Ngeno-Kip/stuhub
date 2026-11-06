const SPREADSHEET_ID = '1ROKDeBjkxiVZJ4tje-2Cfz8MMaWlha4F69hV50cWmeA';
const PASSWORD_ROUNDS = 10000;
const TABLES = {
  Users: ['id', 'name', 'email', 'password', 'role'],
  Tickets: [
    'ticketNumber',
    'subject',
    'description',
    'status',
    'priority',
    'clientId',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  Messages: ['id', 'ticketNumber', 'senderId', 'message', 'createdAt'],
};

function doGet() {
  return response(200, { service: 'Stuhub Sheets API', method: 'POST' });
}

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    const expectedApiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expectedApiKey || request.apiKey !== expectedApiKey) {
      return response(403, { message: 'Invalid API key' });
    }

    const action = request.action;
    const data = request.data || {};
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    ensureTables(spreadsheet);

    if (action === 'health') {
      return response(200, { message: 'Connected', spreadsheet: spreadsheet.getName() });
    }
    if (action === 'register') return handleRegister(data);
    if (action === 'login') return handleLogin(data);
    if (action === 'seedAdmin') return handleSeedAdmin(data);

    const tokenUser = verifyToken(request.token);
    if (!tokenUser) return response(401, { message: 'Unauthorized' });
    const currentUser = findUserById(tokenUser.id);
    if (!currentUser) return response(401, { message: 'User not found' });

    if (action === 'getMe') {
      return response(200, { user: publicUser(currentUser) });
    }
    if (action === 'getTickets') return handleGetTickets(currentUser);
    if (action === 'createTicket') return handleCreateTicket(currentUser, data);
    if (action === 'getTicketDetails') return handleGetTicketDetails(currentUser, data);
    if (action === 'addMessage') return handleAddMessage(currentUser, data);
    if (action === 'updateTicketStatus') return handleUpdateTicketStatus(currentUser, data);
    if (action === 'getClients') return handleGetClients(currentUser);

    return response(400, { message: 'Invalid action' });
  } catch (error) {
    return response(500, { message: error.message || String(error) });
  }
}

function setupSheets() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureTables(spreadsheet);
  return 'Stuhub tabs are ready.';
}

function ensureTables(spreadsheet) {
  Object.keys(TABLES).forEach(function (name) {
    const headers = TABLES[name];
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (!headers.every(function (header, index) { return existing[index] === header; })) {
      throw new Error('Unexpected headers in the ' + name + ' tab.');
    }
  });
}

function getSheetData(sheetName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const headers = TABLES[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    .filter(function (values) {
      return values.some(function (value) { return value !== ''; });
    })
    .map(function (values) {
      const row = {};
      headers.forEach(function (header, index) { row[header] = values[index]; });
      return row;
    });
}

function appendRow(sheetName, row) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const headers = TABLES[sheetName];
  sheet.appendRow(headers.map(function (header) {
    const value = row[header];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' && value.charAt(0) === '=') return "'" + value;
    return value;
  }));
}

function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return getSheetData('Users').find(function (user) {
    return String(user.email || '').trim().toLowerCase() === normalized;
  }) || null;
}

function findUserById(id) {
  return getSheetData('Users').find(function (user) {
    return String(user.id) === String(id);
  }) || null;
}

function publicUser(user) {
  return { id: String(user.id), name: user.name, email: user.email, role: user.role };
}

function handleRegister(data) {
  if (!data.name || !data.email || !data.password) {
    return response(400, { message: 'Name, email, and password are required' });
  }
  const email = String(data.email).trim().toLowerCase();
  if (findUserByEmail(email)) return response(409, { message: 'Email already registered' });

  const id = Utilities.getUuid();
  const user = {
    id: id,
    name: String(data.name).trim(),
    email: email,
    password: hashPassword(String(data.password)),
    role: 'client',
  };
  appendRow('Users', user);
  return response(201, { token: generateToken(id), user: publicUser(user) });
}

function handleLogin(data) {
  if (!data.email || !data.password) return response(400, { message: 'Email and password are required' });
  const user = findUserByEmail(data.email);
  if (!user || !verifyPassword(String(data.password), String(user.password))) {
    return response(401, { message: 'Invalid credentials' });
  }
  if (String(user.password).indexOf('hmac-sha256$') !== 0) {
    updateUserPassword(user.id, hashPassword(String(data.password)));
  }
  return response(200, { token: generateToken(String(user.id)), user: publicUser(user) });
}

function updateUserPassword(userId, passwordHash) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Users');
  const values = sheet.getDataRange().getValues();
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][0]) === String(userId)) {
      sheet.getRange(rowIndex + 1, 4).setValue(passwordHash);
      return;
    }
  }
}

function handleSeedAdmin(data) {
  if (!data.name || !data.email || !data.password) {
    return response(400, { message: 'Admin name, email, and password are required' });
  }
  const email = String(data.email).trim().toLowerCase();
  const existing = findUserByEmail(email);
  if (existing) return response(200, { message: 'Admin already exists', user: publicUser(existing) });

  const user = {
    id: Utilities.getUuid(),
    name: String(data.name).trim(),
    email: email,
    password: hashPassword(String(data.password)),
    role: 'admin',
  };
  appendRow('Users', user);
  return response(201, { message: 'Admin created', user: publicUser(user) });
}

function handleGetTickets(user) {
  let tickets = getSheetData('Tickets');
  if (user.role !== 'admin') {
    tickets = tickets.filter(function (ticket) { return String(ticket.clientId) === String(user.id); });
  }
  return response(200, { tickets: tickets });
}

function handleCreateTicket(user, data) {
  if (user.role !== 'admin') return response(403, { message: 'Admin only' });
  if (!data.subject || !data.description || !data.clientId) {
    return response(400, { message: 'Subject, description, and clientId are required' });
  }
  const client = findUserById(data.clientId);
  if (!client || client.role !== 'client') return response(404, { message: 'Client not found' });

  const tickets = getSheetData('Tickets');
  const maxNumber = tickets.reduce(function (max, ticket) {
    const match = String(ticket.ticketNumber || '').match(/^STU-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const now = new Date().toISOString();
  const ticketNumber = 'STU-' + String(maxNumber + 1).padStart(4, '0');
  appendRow('Tickets', {
    ticketNumber: ticketNumber,
    subject: String(data.subject).trim(),
    description: String(data.description).trim(),
    status: 'open',
    priority: data.priority || 'medium',
    clientId: String(data.clientId),
    createdBy: String(user.id),
    createdAt: now,
    updatedAt: now,
  });
  return response(201, { message: 'Ticket created', ticketNumber: ticketNumber });
}

function handleGetTicketDetails(user, data) {
  const ticket = getSheetData('Tickets').find(function (item) {
    return String(item.ticketNumber) === String(data.ticketNumber);
  });
  if (!ticket) return response(404, { message: 'Ticket not found' });
  if (user.role !== 'admin' && String(ticket.clientId) !== String(user.id)) {
    return response(403, { message: 'Unauthorized' });
  }
  const messages = getSheetData('Messages').filter(function (message) {
    return String(message.ticketNumber) === String(data.ticketNumber);
  });
  return response(200, { ticket: ticket, messages: messages });
}

function handleAddMessage(user, data) {
  if (!data.ticketNumber || !data.message) return response(400, { message: 'Ticket and message are required' });
  const ticket = getSheetData('Tickets').find(function (item) {
    return String(item.ticketNumber) === String(data.ticketNumber);
  });
  if (!ticket) return response(404, { message: 'Ticket not found' });
  if (user.role !== 'admin' && String(ticket.clientId) !== String(user.id)) {
    return response(403, { message: 'Unauthorized' });
  }

  appendRow('Messages', {
    id: Utilities.getUuid(),
    ticketNumber: String(data.ticketNumber),
    senderId: String(user.id),
    message: String(data.message).trim(),
    createdAt: new Date().toISOString(),
  });
  return response(201, { message: 'Message added' });
}

function handleUpdateTicketStatus(user, data) {
  if (user.role !== 'admin') return response(403, { message: 'Admin only' });
  const allowedStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (allowedStatuses.indexOf(data.status) === -1) return response(400, { message: 'Invalid status' });

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Tickets');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const ticketIndex = headers.indexOf('ticketNumber');
  const statusIndex = headers.indexOf('status');
  const updatedIndex = headers.indexOf('updatedAt');
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][ticketIndex]) === String(data.ticketNumber)) {
      sheet.getRange(rowIndex + 1, statusIndex + 1).setValue(data.status);
      sheet.getRange(rowIndex + 1, updatedIndex + 1).setValue(new Date().toISOString());
      return response(200, { message: 'Status updated' });
    }
  }
  return response(404, { message: 'Ticket not found' });
}

function handleGetClients(user) {
  if (user.role !== 'admin') return response(403, { message: 'Admin only' });
  const clients = getSheetData('Users')
    .filter(function (person) { return person.role === 'client'; })
    .map(function (person) { return { id: String(person.id), name: person.name, email: person.email }; });
  return response(200, { clients: clients });
}

function hashPassword(password) {
  const secret = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET Script Property is not configured');
  const salt = Utilities.getUuid();
  let digest = Utilities.computeHmacSha256Signature(salt + ':' + password, secret);
  for (let i = 1; i < PASSWORD_ROUNDS; i += 1) {
    digest = Utilities.computeHmacSha256Signature(digest, secret);
  }
  return 'hmac-sha256$' + salt + '$' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function verifyPassword(password, stored) {
  if (stored.indexOf('hmac-sha256$') !== 0) return stored === password;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const secret = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET Script Property is not configured');

  let digest = Utilities.computeHmacSha256Signature(parts[1] + ':' + password, secret);
  for (let i = 1; i < PASSWORD_ROUNDS; i += 1) {
    digest = Utilities.computeHmacSha256Signature(digest, secret);
  }
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '') === parts[2];
}

function generateToken(userId) {
  const secret = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET Script Property is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ id: String(userId), iat: now, exp: now + 7 * 24 * 60 * 60 }));
  const unsigned = header + '.' + payload;
  const signature = Utilities.computeHmacSha256Signature(unsigned, secret);
  return unsigned + '.' + Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
    if (!secret) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const signature = Utilities.computeHmacSha256Signature(parts[0] + '.' + parts[1], secret);
    if (Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '') !== parts[2]) return null;
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: String(payload.id) };
  } catch (error) {
    return null;
  }
}

function base64Url(value) {
  return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function response(status, data) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: status }, data)))
    .setMimeType(ContentService.MimeType.JSON);
}
