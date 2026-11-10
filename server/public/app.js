const state = {
  token: localStorage.getItem('stuhub.token') || '',
  user: null,
  mode: 'login',
  registrationEmail: '',
  tickets: [],
  selectedTicket: '',
  events: [],
  bookings: [],
  dashboardSection: 'events',
  pendingAccounts: [],
  expiryTimer: null,
  expiryRefreshStarted: false,
};

const elements = {
  systemState: document.getElementById('system-state'),
  systemStateText: document.getElementById('system-state-text'),
  notice: document.getElementById('notice'),
  authView: document.getElementById('auth-view'),
  dashboardView: document.getElementById('dashboard-view'),
  authFormPanel: document.getElementById('auth-form-panel'),
  registrationSuccess: document.getElementById('registration-success'),
  approvalMessage: document.getElementById('approval-message'),
  authForm: document.getElementById('auth-form'),
  nameField: document.getElementById('name-field'),
  confirmPasswordField: document.getElementById('confirm-password-field'),
  passwordMismatchMessage: document.getElementById('password-mismatch-message'),
  passwordInput: document.getElementById('password-input'),
  confirmPasswordInput: document.getElementById('confirm-password-input'),
  authHeading: document.getElementById('auth-heading'),
  authKicker: document.getElementById('auth-kicker'),
  authSubtitle: document.getElementById('auth-subtitle'),
  authSubmit: document.getElementById('auth-submit'),
  loginTab: document.getElementById('login-tab'),
  registerTab: document.getElementById('register-tab'),
  welcomeHeading: document.getElementById('welcome-heading'),
  welcomeSubtitle: document.getElementById('welcome-subtitle'),
  adminPanel: document.getElementById('admin-panel'),
  clientTicketPanel: document.getElementById('client-ticket-panel'),
  eventAdminPanel: document.getElementById('event-admin-panel'),
  adminBookingsPanel: document.getElementById('admin-bookings-panel'),
  accountsTab: document.getElementById('accounts-tab'),
  ticketsTab: document.getElementById('tickets-tab'),
  eventsTab: document.getElementById('events-tab'),
  clientSelect: document.getElementById('client-select'),
  createTicketForm: document.getElementById('create-ticket-form'),
  clientTicketForm: document.getElementById('client-ticket-form'),
  createEventForm: document.getElementById('create-event-form'),
  ticketCount: document.getElementById('ticket-count'),
  ticketListKicker: document.getElementById('ticket-list-kicker'),
  ticketListHeading: document.getElementById('ticket-list-heading'),
  ticketList: document.getElementById('ticket-list'),
  ticketDetail: document.getElementById('ticket-detail'),
  ticketsView: document.getElementById('tickets-view'),
  eventsView: document.getElementById('events-view'),
  accountsView: document.getElementById('accounts-view'),
  eventList: document.getElementById('event-list'),
  myBookings: document.getElementById('my-bookings'),
  bookingCount: document.getElementById('booking-count'),
  adminBookings: document.getElementById('admin-bookings'),
  reviewCount: document.getElementById('review-count'),
  pendingAccountsList: document.getElementById('pending-accounts'),
  pendingAccountCount: document.getElementById('pending-account-count'),
  paymentInstructionsField: document.getElementById('event-payment-instructions-field'),
  eventImageInput: document.getElementById('event-image-input'),
  eventImagePreview: document.getElementById('event-image-preview'),
  eventImagePreviewImg: document.getElementById('event-image-preview-img'),
};

function showNotice(message, kind = 'info') {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`;
  elements.notice.hidden = !message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatCurrency(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (error) {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options = { ...options, body: JSON.stringify(options.body) };
  }

  const response = await fetch(path, { ...options, headers });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    result = { message: 'The server returned an unreadable response.' };
  }
  if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
  return result;
}

async function checkHealth() {
  try {
    const response = await fetch('/health');
    const result = await response.json();
    if (response.ok) {
      elements.systemState.classList.add('connected');
      elements.systemStateText.textContent = 'Service connected';
    } else {
      elements.systemState.classList.remove('connected');
      elements.systemStateText.textContent = 'Storage setup needed';
      showNotice(`Website is running, but the MySQL database is unavailable: ${result.message}`, 'info');
    }
  } catch (error) {
    elements.systemStateText.textContent = 'Service unavailable';
    showNotice('The server could not be reached. Start the StuHub server and reload this page.', 'error');
  }
}

function setMode(mode) {
  state.mode = mode;
  const registering = mode === 'register';
  elements.authFormPanel.hidden = false;
  elements.registrationSuccess.hidden = true;
  elements.nameField.hidden = !registering;
  elements.nameField.querySelector('input').required = registering;
  elements.confirmPasswordField.hidden = !registering;
  elements.authForm.elements.confirmPassword.required = registering;
  elements.authHeading.textContent = registering ? 'Create your account' : 'Sign in to StuHub';
  elements.authKicker.textContent = registering ? 'GET STARTED' : 'WELCOME BACK';
  elements.authSubtitle.textContent = registering
    ? 'Create an account. An admin will review your access request before you can sign in.'
    : 'Use your account details to continue.';
  elements.authSubmit.textContent = registering ? 'Create account' : 'Sign in';
  elements.loginTab.classList.toggle('active', !registering);
  elements.registerTab.classList.toggle('active', registering);
  const passwordInput = elements.authForm.elements.password;
  passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
  elements.authForm.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = 'password';
    button.textContent = 'Show';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute(
      'aria-label',
      input.id === 'confirm-password-input' ? 'Show password confirmation' : 'Show password',
    );
  });
  updatePasswordMatchMessage();
}

function showAuth() {
  state.user = null;
  elements.authFormPanel.hidden = false;
  elements.registrationSuccess.hidden = true;
  elements.authView.hidden = false;
  elements.dashboardView.hidden = true;
}

function showDashboard() {
  elements.authView.hidden = true;
  elements.dashboardView.hidden = false;
  const isAdmin = state.user.role === 'admin';
  elements.ticketListKicker.textContent = isAdmin ? 'WORK QUEUE' : 'YOUR SUPPORT';
  elements.ticketListHeading.textContent = isAdmin ? 'Tickets' : 'Your tickets';
  elements.welcomeHeading.textContent = isAdmin ? 'Your StuHub dashboard' : 'Discover your next event';
  elements.welcomeSubtitle.textContent = isAdmin
    ? `Welcome back, ${state.user.name || state.user.email}. Manage events, tickets, and payments here.`
    : `Welcome back, ${state.user.name || state.user.email}. Your events and tickets are right here.`;
  elements.adminPanel.hidden = !isAdmin;
  elements.clientTicketPanel.hidden = isAdmin;
  elements.eventAdminPanel.hidden = !isAdmin;
  elements.adminBookingsPanel.hidden = !isAdmin;
  elements.accountsTab.hidden = !isAdmin;
  showNotice('', 'info');
  loadTickets();
  loadEventData();
  setDashboardSection(state.dashboardSection);
  if (isAdmin) loadClients();
  if (isAdmin) loadPendingAccounts();
  if (!state.expiryTimer) {
    state.expiryTimer = window.setInterval(updatePaymentCountdowns, 1000);
  }
}

function saveSession(result) {
  state.token = result.token;
  state.user = result.user;
  localStorage.setItem('stuhub.token', state.token);
  localStorage.setItem('stuhub.user', JSON.stringify(state.user));
  showDashboard();
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.tickets = [];
  state.selectedTicket = '';
  state.events = [];
  state.bookings = [];
  state.pendingAccounts = [];
  state.dashboardSection = 'events';
  state.expiryRefreshStarted = false;
  if (state.expiryTimer) {
    window.clearInterval(state.expiryTimer);
    state.expiryTimer = null;
  }
  localStorage.removeItem('stuhub.token');
  localStorage.removeItem('stuhub.user');
  elements.authForm.reset();
  setMode('login');
  showAuth();
}

function setDashboardSection(section) {
  const validSection = section === 'accounts' && state.user?.role !== 'admin' ? 'tickets' : section;
  state.dashboardSection = validSection;
  const showingTickets = validSection === 'tickets';
  const showingEvents = validSection === 'events';
  const showingAccounts = validSection === 'accounts';
  elements.ticketsView.hidden = !showingTickets;
  elements.eventsView.hidden = !showingEvents;
  elements.accountsView.hidden = !showingAccounts;
  elements.ticketsTab.classList.toggle('active', showingTickets);
  elements.eventsTab.classList.toggle('active', showingEvents);
  elements.accountsTab.classList.toggle('active', showingAccounts);
  elements.ticketsTab.setAttribute('aria-pressed', String(showingTickets));
  elements.eventsTab.setAttribute('aria-pressed', String(showingEvents));
  elements.accountsTab.setAttribute('aria-pressed', String(showingAccounts));
  if (showingEvents) loadEventData();
  if (showingAccounts) loadPendingAccounts();
}

async function loadPendingAccounts() {
  if (state.user?.role !== 'admin') return;
  elements.pendingAccountsList.innerHTML = '<div class="panel empty-state">Loading approval requests…</div>';
  try {
    const result = await request('/api/accounts/pending');
    state.pendingAccounts = Array.isArray(result.accounts) ? result.accounts : [];
    elements.pendingAccountCount.textContent = String(state.pendingAccounts.length);
    elements.pendingAccountCount.hidden = state.pendingAccounts.length === 0;
    renderPendingAccounts();
  } catch (error) {
    elements.pendingAccountsList.innerHTML = `<div class="panel empty-state">${escapeHtml(error.message)}</div>`;
    showNotice(`Could not load approval requests: ${error.message}`, 'error');
  }
}

function renderPendingAccounts() {
  elements.pendingAccountsList.replaceChildren();
  if (!state.pendingAccounts.length) {
    elements.pendingAccountsList.innerHTML = '<div class="panel empty-state">There are no new account requests to review.</div>';
    return;
  }
  state.pendingAccounts.forEach((account) => {
    const card = document.createElement('article');
    card.className = 'panel booking-card account-request-card';
    card.innerHTML = `
      <div class="booking-card-heading">
        <div><p class="eyebrow">REQUESTED ${escapeHtml(formatDate(account.createdAt))}</p><h3>${escapeHtml(account.name)}</h3></div>
        <span class="status-pill status-awaiting_payment">Pending approval</span>
      </div>
      <p class="account-email">${escapeHtml(account.email)}</p>
      <div class="review-actions">
        <button class="button button-secondary" type="button" data-approval-status="rejected">Reject request</button>
        <button class="button button-primary" type="button" data-approval-status="approved">Approve account</button>
      </div>`;
    card.querySelectorAll('[data-approval-status]').forEach((button) => {
      button.addEventListener('click', () => reviewAccount(account, button.dataset.approvalStatus));
    });
    elements.pendingAccountsList.append(card);
  });
}

async function reviewAccount(account, approvalStatus) {
  const action = approvalStatus === 'approved' ? 'approve' : 'reject';
  if (!window.confirm(`Are you sure you want to ${action} ${account.name} (${account.email})?`)) return;
  try {
    const result = await request(`/api/accounts/${encodeURIComponent(account.id)}/approval`, {
      method: 'PATCH',
      body: { approvalStatus },
    });
    showNotice(result.message, 'success');
    await loadPendingAccounts();
    await loadClients();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function loadEventData() {
  if (!state.token) return;
  elements.eventList.innerHTML = '<div class="panel empty-state">Loading events…</div>';
  elements.myBookings.innerHTML = '<div class="panel empty-state">Loading bookings…</div>';
  if (state.user?.role === 'admin') {
    elements.adminBookings.innerHTML = '<div class="panel empty-state">Loading payment reviews…</div>';
  }
  try {
    const [eventResult, bookingResult] = await Promise.all([
      request('/api/events'),
      request('/api/events/bookings'),
    ]);
    state.events = Array.isArray(eventResult.events) ? eventResult.events : [];
    state.bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    renderEvents();
    renderMyBookings();
    if (state.user?.role === 'admin') renderAdminBookings();
    state.expiryRefreshStarted = false;
  } catch (error) {
    elements.eventList.innerHTML = `<div class="panel empty-state">${escapeHtml(error.message)}</div>`;
    elements.myBookings.innerHTML = '<div class="panel empty-state">Bookings could not be loaded.</div>';
    if (state.user?.role === 'admin') {
      elements.adminBookings.innerHTML = '<div class="panel empty-state">Payment reviews could not be loaded.</div>';
    }
    showNotice(`Could not load events: ${error.message}`, 'error');
  }
}

function renderEvents() {
  elements.eventList.replaceChildren();
  if (!state.events.length) {
    elements.eventList.innerHTML = '<div class="panel empty-state">No upcoming events yet. Check back soon.</div>';
    return;
  }

  state.events.forEach((event) => {
    const eventBooking = state.user.role === 'admin'
      ? null
      : state.bookings.find((booking) => (
        String(booking.eventId) === String(event.id) &&
        ['awaiting_payment', 'payment_submitted', 'paid'].includes(booking.status)
      ));
    const full = Number(event.spotsRemaining) < 1;
    const action = state.user.role === 'admin'
      ? '<span class="event-admin-tag">Admin event</span>'
      : eventBooking
        ? `<span class="status-pill status-${escapeHtml(eventBooking.status)}">${escapeHtml(eventBooking.status.replaceAll('_', ' '))}</span>`
        : `<button class="button button-primary event-book-button" type="button" data-event-id="${escapeHtml(event.id)}"${full ? ' disabled' : ''}>${full ? 'Fully booked' : Number(event.price) === 0 ? 'Reserve a place' : 'Reserve & pay'}</button>`;
    const card = document.createElement('article');
    card.className = 'panel event-card';
    const imagePaths = [
      '/images/event-live.jpg',
      '/images/event-festival.jpg',
      '/images/event-night.jpg',
    ];
    const imageIndex = Math.abs(Number(event.id) || 0) % imagePaths.length;
    card.innerHTML = `
      <div class="event-card-image">
        <img src="${escapeHtml(event.imageData || event.imageUrl || imagePaths[imageIndex])}" alt="${escapeHtml(event.title)} — event photography" loading="lazy" />
        <span class="event-image-label">GOOD TIMES AWAIT</span>
      </div>
      <div class="event-card-topline">
        <span class="event-date">${escapeHtml(formatDate(event.startsAt))}</span>
        <span class="event-spots">${full ? 'Fully booked' : `${escapeHtml(event.spotsRemaining)} places left`}</span>
      </div>
      <h3>${escapeHtml(event.title)}</h3>
      <p class="event-description">${escapeHtml(event.description)}</p>
      <div class="event-facts">
        <span><strong>Where</strong>${escapeHtml(event.location)}</span>
        <span><strong>Price</strong>${Number(event.price) === 0 ? 'Free' : escapeHtml(formatCurrency(event.price, event.currency))}</span>
      </div>
      <div class="event-card-action">${action}</div>`;
    const button = card.querySelector('.event-book-button');
    if (button) {
      button.addEventListener('click', () => reserveEvent(event));
    }
    elements.eventList.append(card);
  });
}

function bookingStatusLabel(status) {
  return ({
    awaiting_payment: 'Awaiting transfer',
    payment_submitted: 'Transfer submitted',
    paid: 'Confirmed',
    expired: 'Expired',
    rejected: 'Transfer not confirmed',
  })[status] || status.replaceAll('_', ' ');
}

function renderMyBookings() {
  document.getElementById('my-bookings-heading').textContent = state.user.role === 'admin'
    ? 'All event bookings'
    : 'My bookings';
  const bookings = state.bookings.filter((booking) => (
    state.user.role === 'admin' || String(booking.userId) === String(state.user.id)
  ));
  elements.bookingCount.textContent = String(bookings.length);
  if (!bookings.length) {
    elements.myBookings.innerHTML = '<div class="panel empty-state">Your event reservations will show up here.</div>';
    return;
  }

  elements.myBookings.replaceChildren();
  bookings.forEach((booking) => {
    const card = document.createElement('article');
    card.className = 'panel booking-card';
    const deadline = booking.paymentDeadline ? new Date(booking.paymentDeadline).getTime() : 0;
    const awaitingPayment = booking.status === 'awaiting_payment' && deadline > Date.now();
    const bookingActions = awaitingPayment
      ? `<div class="payment-instructions"><strong>Transfer instructions</strong><p>${escapeHtml(booking.paymentInstructions || 'Follow the event organizer’s payment instructions.')}</p></div>
        <p class="countdown-line">Complete your transfer in <strong data-deadline="${escapeHtml(booking.paymentDeadline)}">15:00</strong></p>
        <form class="payment-reference-form" data-booking-id="${escapeHtml(booking.id)}">
          <label><span>Transfer receipt / transaction reference</span><input name="paymentReference" maxlength="120" placeholder="Enter the transfer reference" required /></label>
          <button class="button button-primary" type="submit">I’ve made the transfer</button>
        </form>`
      : booking.status === 'payment_submitted'
        ? `<p class="booking-note">Transfer reference: <strong>${escapeHtml(booking.paymentReference)}</strong>. An admin will review it shortly.</p>`
        : booking.status === 'expired'
          ? '<p class="booking-note">The 15-minute payment window ended. Reserve again if places are still available.</p>'
          : booking.status === 'rejected'
            ? `<p class="booking-note">Your transfer could not be confirmed${booking.paymentReference ? ` (reference: ${escapeHtml(booking.paymentReference)})` : ''}. You can reserve again if places are still available.</p>`
            : booking.status === 'paid' && Number(booking.price) > 0
              ? `<p class="booking-note">Payment confirmed${booking.paymentReference ? ` · Reference ${escapeHtml(booking.paymentReference)}` : ''}. Your place is secured.</p>`
              : '<p class="booking-note">Your place is confirmed.</p>';

    card.innerHTML = `
      <div class="booking-card-heading">
        <div><p class="eyebrow">${escapeHtml(formatDate(booking.eventStartsAt))}</p><h3>${escapeHtml(booking.eventTitle)}</h3></div>
        <span class="status-pill status-${escapeHtml(booking.status)}">${escapeHtml(bookingStatusLabel(booking.status))}</span>
      </div>
      <div class="event-facts"><span><strong>Location</strong>${escapeHtml(booking.location || 'See event details')}</span>
        <span><strong>Amount</strong>${Number(booking.price) === 0 ? 'Free' : escapeHtml(formatCurrency(booking.price, booking.currency))}</span></div>
      ${bookingActions}`;
    const form = card.querySelector('.payment-reference-form');
    if (form) form.addEventListener('submit', submitPaymentReference);
    elements.myBookings.append(card);
  });
}

function renderAdminBookings() {
  const reviews = state.bookings.filter((booking) => booking.status === 'payment_submitted');
  elements.reviewCount.textContent = String(reviews.length);
  if (!reviews.length) {
    elements.adminBookings.innerHTML = '<div class="panel empty-state">No transfers need review right now.</div>';
    return;
  }

  elements.adminBookings.replaceChildren();
  reviews.forEach((booking) => {
    const card = document.createElement('article');
    card.className = 'panel booking-card review-card';
    card.innerHTML = `
      <div class="booking-card-heading">
        <div><p class="eyebrow">${escapeHtml(booking.userEmail)} · ${escapeHtml(formatDate(booking.paymentSubmittedAt))}</p><h3>${escapeHtml(booking.eventTitle)}</h3></div>
        <span class="status-pill status-payment_submitted">Transfer submitted</span>
      </div>
      <div class="event-facts"><span><strong>Client</strong>${escapeHtml(booking.userName)}</span>
        <span><strong>Amount</strong>${escapeHtml(formatCurrency(booking.price, booking.currency))}</span>
        <span><strong>Receipt reference</strong>${escapeHtml(booking.paymentReference)}</span></div>
      <div class="review-actions">
        <button class="button button-secondary" type="button" data-review-status="rejected">Reject reference</button>
        <button class="button button-primary" type="button" data-review-status="paid">Confirm payment</button>
      </div>`;
    card.querySelectorAll('[data-review-status]').forEach((button) => {
      button.addEventListener('click', () => reviewPayment(booking, button.dataset.reviewStatus));
    });
    elements.adminBookings.append(card);
  });
}

function updatePaymentCountdowns() {
  let expired = false;
  document.querySelectorAll('[data-deadline]').forEach((element) => {
    const remaining = new Date(element.dataset.deadline).getTime() - Date.now();
    if (remaining <= 0) {
      element.textContent = '00:00';
      expired = true;
      return;
    }
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    element.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });
  if (expired && !state.expiryRefreshStarted) {
    state.expiryRefreshStarted = true;
    loadEventData();
  }
}

async function reserveEvent(event) {
  const price = Number(event.price) === 0 ? 'free' : formatCurrency(event.price, event.currency);
  if (!window.confirm(`Reserve a place at "${event.title}" (${price})? Paid bookings expire after 15 minutes.`)) return;
  try {
    await request(`/api/events/${encodeURIComponent(event.id)}/bookings`, { method: 'POST' });
    showNotice(Number(event.price) === 0
      ? 'Your free event place is confirmed.'
      : 'Your place is reserved for 15 minutes. Complete the transfer and submit its reference below.',
    'success');
    await loadEventData();
  } catch (error) {
    showNotice(error.message, 'error');
    await loadEventData();
  }
}

async function submitPaymentReference(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const bookingId = form.dataset.bookingId;
  const button = form.querySelector('button');
  const paymentReference = String(new FormData(form).get('paymentReference') || '').trim();
  button.disabled = true;
  try {
    await request(`/api/events/bookings/${encodeURIComponent(bookingId)}/payment-reference`, {
      method: 'POST',
      body: { paymentReference },
    });
    showNotice('Transfer reference sent. Your place is held while an admin confirms payment.', 'success');
    await loadEventData();
  } catch (error) {
    showNotice(error.message, 'error');
    button.disabled = false;
  }
}

async function reviewPayment(booking, status) {
  const action = status === 'paid' ? 'confirm this transfer' : 'reject this transfer reference';
  if (!window.confirm(`Are you sure you want to ${action} for ${booking.userEmail}?`)) return;
  try {
    await request(`/api/events/bookings/${encodeURIComponent(booking.id)}/payment`, {
      method: 'PATCH',
      body: { status },
    });
    showNotice(status === 'paid' ? 'Payment confirmed; the client’s place is secured.' : 'Transfer reference rejected.', 'success');
    await loadEventData();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function loadTickets() {
  elements.ticketList.innerHTML = '<div class="empty-state">Loading tickets…</div>';
  try {
    const result = await request('/api/tickets');
    state.tickets = Array.isArray(result.tickets) ? result.tickets : [];
    elements.ticketCount.textContent = String(state.tickets.length);
    renderTicketList();
    if (state.selectedTicket && state.tickets.some((ticket) => ticket.ticketNumber === state.selectedTicket)) {
      await openTicket(state.selectedTicket);
    } else if (state.tickets.length) {
      await openTicket(state.tickets[0].ticketNumber);
    } else {
      state.selectedTicket = '';
      renderEmptyDetail();
    }
  } catch (error) {
    elements.ticketList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    elements.ticketCount.textContent = '0';
    renderEmptyDetail();
  }
}

function renderTicketList() {
  elements.ticketList.replaceChildren();
  if (!state.tickets.length) {
    elements.ticketList.innerHTML = '<div class="empty-state">No tickets yet.</div>';
    return;
  }

  state.tickets.forEach((ticket) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ticket-card${ticket.ticketNumber === state.selectedTicket ? ' selected' : ''}`;
    button.innerHTML = `
      <span class="ticket-topline">
        <span class="ticket-number">${escapeHtml(ticket.ticketNumber)}</span>
        <span class="status-pill status-${escapeHtml(ticket.status || 'open')}">${escapeHtml((ticket.status || 'open').replace('_', ' '))}</span>
      </span>
      <span class="ticket-subject">${escapeHtml(ticket.subject || 'Untitled ticket')}</span>
      ${state.user.role === 'admin' && ticket.clientName ? `<span class="ticket-client">From ${escapeHtml(ticket.clientName)}</span>` : ''}
      <span class="ticket-meta">
        <span>${escapeHtml(formatDate(ticket.createdAt))}</span>
        <span class="priority-pill priority-${escapeHtml(ticket.priority || 'medium')}">${escapeHtml(ticket.priority || 'medium')} priority</span>
      </span>`;
    button.addEventListener('click', () => openTicket(ticket.ticketNumber));
    elements.ticketList.append(button);
  });
}

function renderEmptyDetail() {
  elements.ticketDetail.innerHTML = `
    <div class="empty-detail">
      <div class="empty-detail-icon">↗</div>
      <h2>No ticket selected</h2>
      <p>Choose a ticket from the list to see its conversation.</p>
    </div>`;
}

async function openTicket(ticketNumber) {
  state.selectedTicket = ticketNumber;
  renderTicketList();
  elements.ticketDetail.innerHTML = '<div class="empty-state">Loading ticket…</div>';
  try {
    const result = await request(`/api/tickets/${encodeURIComponent(ticketNumber)}`);
    renderTicketDetail(result.ticket, result.messages || []);
  } catch (error) {
    elements.ticketDetail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderTicketDetail(ticket, messages) {
  const isAdmin = state.user.role === 'admin';
  const statusOptions = ['open', 'in_progress', 'resolved', 'closed'];
  const statusControl = isAdmin
    ? `<select class="status-control" id="status-control" aria-label="Ticket status">
        ${statusOptions.map((status) => `<option value="${status}"${ticket.status === status ? ' selected' : ''}>${status.replace('_', ' ')}</option>`).join('')}
      </select>`
    : `<span class="status-pill status-${escapeHtml(ticket.status || 'open')}">${escapeHtml((ticket.status || 'open').replace('_', ' '))}</span>`;

  elements.ticketDetail.innerHTML = `
    <div class="detail-titlebar">
      <div>
        <p class="eyebrow">${escapeHtml(ticket.ticketNumber)}</p>
        <h2>${escapeHtml(ticket.subject || 'Untitled ticket')}</h2>
      </div>
      ${statusControl}
    </div>
    <p class="detail-description">${escapeHtml(ticket.description || '')}</p>
    <div class="detail-facts">
      <span>Priority: <strong>${escapeHtml(ticket.priority || 'medium')}</strong></span>
      <span>Created: <strong>${escapeHtml(formatDate(ticket.createdAt))}</strong></span>
      ${isAdmin && ticket.clientName ? `<span>Client: <strong>${escapeHtml(ticket.clientName)}${ticket.clientEmail ? ` · ${escapeHtml(ticket.clientEmail)}` : ''}</strong></span>` : ''}
    </div>
    <div class="conversation-heading"><h3>Conversation</h3><span class="count-pill">${messages.length}</span></div>
    <div class="message-list" id="message-list">
      ${messages.length ? messages.map((message) => `
        <article class="message${String(message.senderId) === String(state.user.id) ? ' mine' : ''}">
          <div class="message-top"><span>${String(message.senderId) === String(state.user.id) ? 'You' : 'Support'}</span><span>${escapeHtml(formatDate(message.createdAt))}</span></div>
          <p class="message-text">${escapeHtml(message.message)}</p>
        </article>`).join('') : '<div class="empty-state">No replies yet. Send the first update below.</div>'}
    </div>
    <form class="message-form" id="message-form">
      <label class="visually-hidden" for="message-input">Write a message</label>
      <textarea id="message-input" name="message" rows="2" maxlength="2000" placeholder="Write a reply…" required></textarea>
      <button class="button button-primary" type="submit">Send</button>
    </form>`;

  const statusSelect = document.getElementById('status-control');
  if (statusSelect) {
    statusSelect.addEventListener('change', async (event) => {
      try {
        await request(`/api/tickets/${encodeURIComponent(ticket.ticketNumber)}/status`, {
          method: 'PATCH', body: { status: event.target.value },
        });
        showNotice('Ticket status updated.', 'success');
        await loadTickets();
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });
  }

  document.getElementById('message-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get('message') || '').trim();
    if (!message) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await request(`/api/tickets/${encodeURIComponent(ticket.ticketNumber)}/messages`, {
        method: 'POST', body: { message },
      });
      showNotice('Reply sent.', 'success');
      await openTicket(ticket.ticketNumber);
    } catch (error) {
      showNotice(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function loadClients() {
  try {
    const result = await request('/api/clients');
    const clients = Array.isArray(result.clients) ? result.clients : [];
    elements.clientSelect.innerHTML = '<option value="">Choose a client</option>';
    clients.forEach((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = `${client.name} · ${client.email}`;
      elements.clientSelect.append(option);
    });
  } catch (error) {
    showNotice(`Could not load clients: ${error.message}`, 'error');
  }
}

elements.loginTab.addEventListener('click', () => setMode('login'));
elements.registerTab.addEventListener('click', () => setMode('register'));
function updatePasswordMatchMessage() {
  const mismatch = Boolean(
    elements.confirmPasswordInput.value &&
    elements.passwordInput.value !== elements.confirmPasswordInput.value,
  );
  elements.passwordMismatchMessage.hidden = !mismatch || state.mode !== 'register';
  if (mismatch && state.mode === 'register') {
    elements.confirmPasswordInput.setAttribute('aria-invalid', 'true');
  } else {
    elements.confirmPasswordInput.removeAttribute('aria-invalid');
  }
}
elements.passwordInput.addEventListener('input', updatePasswordMatchMessage);
elements.confirmPasswordInput.addEventListener('input', updatePasswordMatchMessage);
elements.authForm.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    button.textContent = showing ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(showing));
    button.setAttribute(
      'aria-label',
      `${showing ? 'Hide' : 'Show'} ${input.id === 'confirm-password-input' ? 'password confirmation' : 'password'}`,
    );
    input.focus();
  });
});
document.getElementById('approval-back-to-login').addEventListener('click', () => {
  elements.authForm.reset();
  setMode('login');
  elements.authForm.elements.email.value = state.registrationEmail;
  showNotice('', 'info');
  elements.authForm.elements.email.focus();
});
elements.ticketsTab.addEventListener('click', () => setDashboardSection('tickets'));
elements.eventsTab.addEventListener('click', () => setDashboardSection('events'));
elements.accountsTab.addEventListener('click', () => setDashboardSection('accounts'));
document.getElementById('refresh-events-button').addEventListener('click', loadEventData);
document.getElementById('refresh-accounts-button').addEventListener('click', loadPendingAccounts);

elements.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  if (state.mode === 'register' && data.password !== data.confirmPassword) {
    updatePasswordMatchMessage();
    elements.authForm.elements.confirmPassword.focus();
    return;
  }
  delete data.confirmPassword;
  const endpoint = state.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
  elements.authSubmit.disabled = true;
  elements.authSubmit.textContent = state.mode === 'register' ? 'Creating account…' : 'Signing in…';
  try {
    const result = await request(endpoint, { method: 'POST', body: data });
    if (state.mode === 'register') {
      state.registrationEmail = data.email;
      elements.authForm.reset();
      setMode('login');
      elements.authFormPanel.hidden = true;
      elements.registrationSuccess.hidden = false;
      elements.approvalMessage.textContent = `We’ve received your request for ${data.email}. Your account is waiting for admin approval. You’ll be able to sign in after an administrator approves it.`;
      showNotice('', 'info');
      document.getElementById('approval-back-to-login').focus();
      return;
    }
    saveSession(result);
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    elements.authSubmit.disabled = false;
    elements.authSubmit.textContent = state.mode === 'register' ? 'Create account' : 'Sign in';
  }
});

elements.createTicketForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await request('/api/tickets', { method: 'POST', body: data });
    event.currentTarget.reset();
    showNotice('Ticket created.', 'success');
    await loadTickets();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

elements.clientTicketForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const data = Object.fromEntries(form.entries());
  const button = formElement.querySelector('button');
  button.disabled = true;
  try {
    const result = await request('/api/tickets', { method: 'POST', body: data });
    formElement.reset();
    state.selectedTicket = result.ticketNumber || '';
    await loadTickets();
    showNotice(
      `Support request${result.ticketNumber ? ` ${result.ticketNumber}` : ''} sent. You can follow updates in your tickets below.`,
      'success',
    );
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

const eventPriceInput = elements.createEventForm.elements.price;
const eventPaymentInstructionsInput = elements.createEventForm.elements.paymentInstructions;
let eventImagePreviewUrl = '';

function clearEventImagePreview() {
  if (eventImagePreviewUrl) URL.revokeObjectURL(eventImagePreviewUrl);
  eventImagePreviewUrl = '';
  elements.eventImagePreviewImg.removeAttribute('src');
  elements.eventImagePreview.hidden = true;
}

elements.eventImageInput.addEventListener('change', () => {
  clearEventImagePreview();
  const [file] = elements.eventImageInput.files;
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    elements.eventImageInput.value = '';
    showNotice('Choose a JPG, PNG, or WebP event image.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    elements.eventImageInput.value = '';
    showNotice('Event images must be 5 MB or smaller.', 'error');
    return;
  }
  eventImagePreviewUrl = URL.createObjectURL(file);
  elements.eventImagePreviewImg.src = eventImagePreviewUrl;
  elements.eventImagePreview.hidden = false;
});

document.getElementById('remove-event-image').addEventListener('click', () => {
  elements.eventImageInput.value = '';
  clearEventImagePreview();
});

function updatePaymentInstructionsRequired() {
  const paidEvent = Number(eventPriceInput.value) > 0;
  elements.paymentInstructionsField.hidden = !paidEvent;
  eventPaymentInstructionsInput.required = paidEvent;
}

eventPriceInput.addEventListener('input', updatePaymentInstructionsRequired);
updatePaymentInstructionsRequired();

elements.createEventForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const startsAtValue = form.get('startsAt');
  const localStart = new Date(startsAtValue);
  if (Number.isNaN(localStart.getTime())) {
    showNotice('Enter a valid event date and time.', 'error');
    return;
  }
  form.set('startsAt', localStart.toISOString());
  form.set('capacity', String(Number(form.get('capacity'))));
  form.set('price', String(Number(form.get('price'))));
  form.set('currency', String(form.get('currency')).trim().toUpperCase());
  const button = formElement.querySelector('button');
  button.disabled = true;
  try {
    await request('/api/events', { method: 'POST', body: form });
    formElement.reset();
    clearEventImagePreview();
    formElement.elements.currency.value = 'KES';
    formElement.elements.price.value = '0';
    updatePaymentInstructionsRequired();
    showNotice('Event published. Clients can now reserve a place.', 'success');
    await loadEventData();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('refresh-button').addEventListener('click', () => {
  loadTickets();
  loadEventData();
});
document.getElementById('signout-button').addEventListener('click', clearSession);

async function start() {
  await checkHealth();
  if (!state.token) return;
  try {
    const result = await request('/api/auth/me');
    state.user = result;
    localStorage.setItem('stuhub.user', JSON.stringify(result));
    showDashboard();
  } catch (error) {
    if (error.message !== 'MySQL database is unavailable.') clearSession();
    else showNotice('Website is running, but the MySQL database connection is not ready.', 'info');
  }
}

setMode('login');
start();
