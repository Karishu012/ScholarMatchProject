"use strict";

const CATEGORY_LABELS = {
  academic_record: "Academic marksheet / transcript",
  enrollment_certificate: "College enrollment / bonafide certificate",
  fee_receipt: "College fee payment receipt",
  income_certificate: "Family income certificate",
  id_proof: "Government ID proof",
};
const PROFILE_FIELDS = [
  "fullName", "phone", "dateOfBirth", "gender", "address", "city", "state", "postalCode",
  "fatherName", "motherName", "familyMembers", "parentOccupation", "annualIncome", "course",
  "educationLevel", "institution", "currentYear", "enrollmentYear", "expectedGraduation", "marks",
];
let csrfToken = "";
let user = null;
let profile = {};
let scholarships = [];
let applications = [];
let uploadedDocuments = [];
let reminders = [];
let adminApplications = [];
let adminDocuments = [];
let authMode = "login";
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "SM";
}

function formatAmount(amount) {
  return new Intl.NumberFormat("en-IN").format(amount);
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  const date = dateValue(value);
  return date ? date.toLocaleDateString("en-IN", options) : "—";
}

function daysUntil(value) {
  const date = dateValue(value);
  if (!date) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(options.method || "GET")) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && user) {
      user = null;
      document.getElementById("app-shell").hidden = true;
      document.getElementById("auth-screen").hidden = false;
      setAuthMode("login");
    }
    throw new Error(payload.error || "The request could not be completed.");
  }
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  return payload;
}

function showAuth() {
  user = null;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("auth-screen").hidden = false;
  document.getElementById("auth-error").textContent = "";
  document.getElementById("auth-form").reset();
  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  document.getElementById("auth-heading").textContent = register ? "Create your account" : "Welcome back";
  document.getElementById("auth-description").textContent = register
    ? "Create a private account to save your profile and applications."
    : "Sign in to find scholarships that fit your journey.";
  document.getElementById("auth-name-field").hidden = !register;
  document.querySelector("#auth-name-field input").required = register;
  document.querySelector("#auth-form [name='password']").autocomplete = register ? "new-password" : "current-password";
  document.getElementById("auth-password-hint").hidden = !register;
  document.getElementById("auth-submit").innerHTML = register ? "Create account <span aria-hidden=\"true\">→</span>" : "Sign in <span aria-hidden=\"true\">→</span>";
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.getElementById("auth-error").textContent = "";
}

function profileReadyToApply() {
  const required = [
    "fullName", "phone", "dateOfBirth", "gender", "address", "city", "state", "postalCode",
    "fatherName", "motherName", "familyMembers", "annualIncome", "course", "educationLevel",
    "institution", "currentYear", "marks",
  ];
  return required.every((field) => String(profile[field] ?? "").trim() !== "");
}

function profileStrength() {
  const filled = PROFILE_FIELDS.filter((field) => String(profile[field] ?? "").trim() !== "").length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

function setRoleNavigation() {
  const isAdmin = user.role === "admin";
  document.querySelector('nav[aria-label="Main navigation"]').hidden = isAdmin;
  document.querySelector('nav[aria-label="Administration"]').hidden = !isAdmin;
  document.querySelectorAll(".sidebar-bottom, #top-avatar, #notification-button").forEach((element) => {
    element.hidden = isAdmin;
  });
  document.getElementById("signout-button").hidden = false;
  document.querySelector(".demo-badge").innerHTML = `<span aria-hidden="true">●</span> ${isAdmin ? "Administrator" : "Secure workspace"}`;
}

function setView(view) {
  const names = {
    overview: "Overview",
    scholarships: "Find scholarships",
    applications: "My applications",
    profile: "Student profile",
    documents: "My documents",
    admin: "Verification desk",
  };
  if (!user || (user.role === "admin" && view !== "admin") || (user.role !== "admin" && view === "admin")) return;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.getElementById("page-title").textContent = names[view] || "Overview";
  document.getElementById("reminder-popover").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applicationFor(scholarshipId) {
  return applications.find((application) => application.scholarshipId === scholarshipId);
}

function renderProfile() {
  const form = document.getElementById("profile-form");
  for (const field of PROFILE_FIELDS) {
    const control = form.elements.namedItem(field);
    if (control) control.value = profile[field] ?? "";
  }
  document.getElementById("profile-email").value = user.email;
  const name = profile.fullName || user.email;
  document.getElementById("welcome-name").textContent = (profile.fullName || "").split(/\s+/)[0] || "there";
  document.getElementById("sidebar-name").textContent = name;
  document.getElementById("sidebar-avatar").textContent = initials(profile.fullName);
  document.getElementById("top-avatar").textContent = initials(profile.fullName);
  const strength = profileStrength();
  document.getElementById("profile-percent").textContent = `${strength}%`;
  document.getElementById("profile-progress-bar").style.width = `${strength}%`;
}

function renderScholarshipCard(scholarship, compact = false) {
  const days = daysUntil(scholarship.deadline);
  const deadlineLabel = days === 0 ? "Due today" : days === 1 ? "1 day left" : days < 0 ? "Closed" : `${days} days left`;
  if (compact) {
    return `<article class="compact-scholarship">
      <span class="scholarship-logo ${escapeHtml(scholarship.color)}" aria-hidden="true">${escapeHtml(scholarship.symbol)}</span>
      <div class="scholarship-info"><strong>${escapeHtml(scholarship.name)}</strong><small>${escapeHtml(scholarship.provider)} · ${scholarship.eligible ? "Eligible" : "Explore criteria"}</small></div>
      <div class="compact-award">₹${formatAmount(scholarship.amount)}<small>${escapeHtml(deadlineLabel)}</small></div>
    </article>`;
  }

  const application = applicationFor(scholarship.id);
  const missingDocuments = scholarship.missingDocuments || [];
  const profileIncomplete = !profileReadyToApply();
  const eligibilityNote = scholarship.eligible
    ? "You meet the listed course and academic eligibility criteria."
    : scholarship.reasons.join(" ");
  let action;
  if (application) {
    action = `<button class="button button-outline" disabled>${escapeHtml(application.status)}</button>`;
  } else if (days < 0) {
    action = `<button class="button button-outline" disabled>Deadline passed</button>`;
  } else if (!scholarship.eligible) {
    action = `<button class="button button-outline" disabled>Not eligible</button>`;
  } else if (profileIncomplete || missingDocuments.length) {
    action = `<button class="button button-outline" disabled title="${profileIncomplete ? "Complete your profile first" : "Upload all required documents first"}">Requirements incomplete</button>`;
  } else {
    action = `<button class="button button-primary" data-apply="${escapeHtml(scholarship.id)}">Apply now →</button>`;
  }

  const documentDetails = scholarship.requiredDocuments.map((category) => {
    const status = scholarship.documentStatus[category];
    return `${escapeHtml(CATEGORY_LABELS[category] || category)}${status ? ` (${escapeHtml(status)})` : " — missing"}`;
  }).join(" · ");
  const documentAction = missingDocuments.length
    ? `<button class="text-button" data-view="documents">Upload missing documents →</button>`
    : `<span class="document-count"><strong>Required documents ready</strong></span>`;
  const eligibilityClass = scholarship.eligible ? "" : "not-eligible";

  return `<article class="scholarship-card">
    <div class="scholarship-card-top">
      <span class="scholarship-logo ${escapeHtml(scholarship.color)}" aria-hidden="true">${escapeHtml(scholarship.symbol)}</span>
      <div class="scholarship-card-main"><h3>${escapeHtml(scholarship.name)}</h3><span class="provider">${escapeHtml(scholarship.provider)}</span></div>
      <span class="match-pill ${scholarship.eligible ? "" : "partial"}">${scholarship.eligible ? "✓ " : ""}${scholarship.matchScore}% match</span>
    </div>
    <div class="card-meta"><span>Award <strong>₹${formatAmount(scholarship.amount)}</strong></span><span>Minimum marks <strong>${scholarship.minimumMarks}%</strong></span><span>Deadline <strong>${escapeHtml(formatDate(scholarship.deadline))}</strong></span></div>
    <div class="eligibility-note ${eligibilityClass}"><strong>${scholarship.eligible ? "Eligibility check" : "Eligibility note"}:</strong> ${escapeHtml(eligibilityNote)}</div>
    <div class="document-checklist"><strong>${scholarship.requiredDocuments.length} required documents</strong><span>${documentDetails || "No supporting documents required."}</span></div>
    <div class="card-bottom"><span class="document-count">${escapeHtml(deadlineLabel)}</span><div class="card-bottom-right">${documentAction}<button class="text-button reminder-toggle" data-reminder="${escapeHtml(scholarship.id)}">${scholarship.reminderActive ? "Turn off reminder" : "Remind me"}</button>${action}</div></div>
  </article>`;
}

function renderOverview() {
  const matches = scholarships.filter((scholarship) => scholarship.eligible);
  const upcoming = scholarships.filter((scholarship) => daysUntil(scholarship.deadline) >= 0 && daysUntil(scholarship.deadline) <= 30)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  document.getElementById("stat-matches").textContent = matches.length;
  document.getElementById("stat-applications").textContent = applications.filter((application) => !["Awarded", "Not selected"].includes(application.status)).length;
  document.getElementById("stat-deadlines").textContent = upcoming.length;
  document.getElementById("match-count").textContent = matches.length;
  const featured = (matches.length ? matches : scholarships).slice(0, 3);
  document.getElementById("featured-scholarships").innerHTML = featured.length
    ? featured.map((scholarship) => renderScholarshipCard(scholarship, true)).join("")
    : `<div class="empty-state">Scholarships will appear here when available.</div>`;
  document.getElementById("upcoming-deadlines").innerHTML = upcoming.slice(0, 3).map((scholarship) => {
    const date = dateValue(scholarship.deadline);
    return `<div class="deadline-item"><span class="date-block"><strong>${date.getDate()}</strong><small>${date.toLocaleDateString("en-IN", { month: "short" })}</small></span><span class="deadline-copy"><strong>${escapeHtml(scholarship.name)}</strong><small>₹${formatAmount(scholarship.amount)} award</small></span><span class="deadline-days">${daysUntil(scholarship.deadline)}d</span></div>`;
  }).join("") || `<div class="empty-state">No deadlines in the next 30 days.</div>`;
}

function renderScholarships() {
  const search = document.getElementById("scholarship-search").value.trim().toLowerCase();
  const filter = document.getElementById("eligibility-filter").value;
  const sort = document.getElementById("sort-scholarships").value;
  const matches = scholarships.filter((scholarship) => scholarship.eligible);
  let visible = scholarships.filter((scholarship) => {
    const text = `${scholarship.name} ${scholarship.provider} ${scholarship.courses.join(" ")}`.toLowerCase();
    return text.includes(search) && (filter === "all" || filter === "ineligible" || scholarship.eligible);
  });
  if (sort === "deadline") visible.sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (sort === "amount") visible.sort((a, b) => b.amount - a.amount);
  if (sort === "match") visible.sort((a, b) => b.matchScore - a.matchScore || a.deadline.localeCompare(b.deadline));
  document.getElementById("match-summary-title").textContent = `We found ${matches.length} ${matches.length === 1 ? "match" : "matches"} for you`;
  document.getElementById("match-summary-copy").textContent = profile.course
    ? `Based on your ${profile.course}, marks, annual family income, and location.`
    : "Complete your profile to get scholarship recommendations.";
  document.getElementById("scholarship-list").innerHTML = visible.length
    ? visible.map((scholarship) => renderScholarshipCard(scholarship)).join("")
    : `<div class="panel empty-state"><strong>No scholarships found</strong><span>Try a different search or update your eligibility filters.</span></div>`;
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/\s+/g, "-");
}

function renderApplications() {
  const inProgress = applications.filter((application) => !["Awarded", "Not selected"].includes(application.status)).length;
  const awards = applications.filter((application) => application.status === "Awarded").length;
  document.getElementById("application-summary").innerHTML = `
    <div class="application-summary-card"><strong>${applications.length}</strong>Total applications</div>
    <div class="application-summary-card"><strong>${inProgress}</strong>In progress</div>
    <div class="application-summary-card"><strong>${awards}</strong>Awards received</div>`;
  document.getElementById("application-list").innerHTML = applications.length ? applications.map((application) => `
    <div class="application-row">
      <div class="application-title"><span class="scholarship-logo ${escapeHtml(application.color)}" aria-hidden="true">${escapeHtml(application.symbol)}</span><span><strong>${escapeHtml(application.name)}</strong><small>${escapeHtml(application.provider)}</small><small class="application-docs">Required documents: ${application.requiredDocuments.map((category) => escapeHtml(CATEGORY_LABELS[category] || category)).join(" · ")}</small></span></div>
      <div class="application-cell"><small>Submitted</small>${escapeHtml(formatDate(application.submittedAt))}</div>
      <div class="application-cell"><small>Deadline</small>${escapeHtml(formatDate(application.deadline))}</div>
      <div><span class="status-pill status-${statusClass(application.status)}">${escapeHtml(application.status)}</span></div>
    </div>`).join("") : `<div class="empty-state"><strong>Your first application starts here.</strong><span>Complete your profile and upload the required documents to apply.</span><button class="text-button" data-view="scholarships">Browse scholarships →</button></div>`;
}

function renderDocuments() {
  const sortedDocuments = [...uploadedDocuments].sort((a, b) => (dateValue(b.uploadedAt)?.getTime() || 0) - (dateValue(a.uploadedAt)?.getTime() || 0));
  document.getElementById("document-list").innerHTML = sortedDocuments.length ? sortedDocuments.map((document) => `
    <div class="document-row">
      <div class="document-name"><strong>${escapeHtml(document.categoryLabel)}</strong><small>${escapeHtml(document.originalName)} · ${(document.fileSize / (1024 * 1024)).toFixed(2)} MB</small>${document.reviewNote ? `<span class="review-note">${escapeHtml(document.reviewNote)}</span>` : ""}</div>
      <div class="application-cell"><small>Uploaded</small>${escapeHtml(formatDate(document.uploadedAt))}</div>
      <div><span class="status-pill status-${statusClass(document.status)}">${escapeHtml(document.status)}</span></div>
      <a class="document-action" href="/api/documents/${encodeURIComponent(document.id)}/download">Download</a>
    </div>`).join("") : `<div class="empty-state"><strong>No documents uploaded yet.</strong><span>Add your academic marksheets, enrollment certificate, fee receipts, or income certificate.</span></div>`;
}

function renderAdmin() {
  const pendingApplications = adminApplications.filter((application) => ["Submitted", "Under review"].includes(application.status)).length;
  const verifiedApplications = adminApplications.filter((application) => ["Verified", "Awarded"].includes(application.status)).length;
  const moreInfoApplications = adminApplications.filter((application) => application.status === "More information").length;
  document.getElementById("admin-pending").textContent = pendingApplications;
  document.getElementById("admin-verified").textContent = verifiedApplications;
  document.getElementById("admin-more-info").textContent = moreInfoApplications;
  document.getElementById("queue-count").textContent = pendingApplications;
  document.getElementById("queue-caption").textContent = `${adminApplications.length} total`;
  document.getElementById("admin-application-list").innerHTML = adminApplications.length ? adminApplications.map((application) => `
    <div class="application-row">
      <div class="application-title"><span class="scholarship-logo ${escapeHtml(application.color)}" aria-hidden="true">${escapeHtml(application.symbol)}</span><span><strong>${escapeHtml(application.name)}</strong><small>${escapeHtml(application.applicant)} · ${escapeHtml(application.email)}</small></span></div>
      <div class="application-cell"><small>Submitted</small>${escapeHtml(formatDate(application.submittedAt))}</div>
      <div><span class="status-pill status-${statusClass(application.status)}">${escapeHtml(application.status)}</span></div>
      <div class="admin-review"><label class="sr-only" for="review-${escapeHtml(application.id)}">Update status for ${escapeHtml(application.applicant)}</label><select id="review-${escapeHtml(application.id)}" data-review-application="${escapeHtml(application.id)}"><option ${application.status === "Submitted" ? "selected" : ""}>Submitted</option><option ${application.status === "Under review" ? "selected" : ""}>Under review</option><option ${application.status === "Verified" ? "selected" : ""}>Verified</option><option ${application.status === "More information" ? "selected" : ""}>More information</option><option ${application.status === "Awarded" ? "selected" : ""}>Awarded</option><option ${application.status === "Not selected" ? "selected" : ""}>Not selected</option></select></div>
    </div>`).join("") : `<div class="empty-state"><strong>The application queue is clear.</strong><span>Student submissions will appear here.</span></div>`;

  const pendingDocuments = adminDocuments.filter((document) => document.status === "Pending review").length;
  document.getElementById("admin-document-caption").textContent = `${pendingDocuments} pending · ${adminDocuments.length} total`;
  document.getElementById("admin-document-list").innerHTML = adminDocuments.length ? adminDocuments.map((document) => `
    <div class="document-row">
      <div class="document-name"><strong>${escapeHtml(document.categoryLabel)} · ${escapeHtml(document.applicant)}</strong><small>${escapeHtml(document.email)} · ${escapeHtml(document.originalName)} · ${(document.fileSize / (1024 * 1024)).toFixed(2)} MB</small>${document.reviewNote ? `<span class="review-note">${escapeHtml(document.reviewNote)}</span>` : ""}</div>
      <div class="application-cell"><small>Uploaded</small>${escapeHtml(formatDate(document.uploadedAt))}</div>
      <div><span class="status-pill status-${statusClass(document.status)}">${escapeHtml(document.status)}</span></div>
      <div class="document-review">
        <a class="document-action" href="/api/documents/${encodeURIComponent(document.id)}/download">Open</a>
        <select aria-label="Verification decision for ${escapeHtml(document.originalName)}" data-document-status="${escapeHtml(document.id)}"><option value="" selected disabled>Choose decision</option><option value="Verified">Verified</option><option value="More information">More information</option><option value="Rejected">Rejected</option></select>
        <input aria-label="Review note for ${escapeHtml(document.originalName)}" maxlength="500" placeholder="Review note" data-document-note="${escapeHtml(document.id)}" />
        <button class="button button-outline" type="button" data-review-document="${escapeHtml(document.id)}">Save review</button>
      </div>
    </div>`).join("") : `<div class="empty-state"><strong>No student documents to review.</strong><span>Uploaded verification documents will appear here.</span></div>`;
}

function renderReminders() {
  const active = scholarships.filter((scholarship) => reminders.includes(scholarship.id) && daysUntil(scholarship.deadline) >= 0);
  document.getElementById("notification-dot").classList.toggle("hidden", active.length === 0);
  document.getElementById("reminder-popover").innerHTML = `<h3>Deadline reminders</h3>${active.length ? active.map((scholarship) => `<div class="reminder-line">${escapeHtml(scholarship.name)}<strong>${daysUntil(scholarship.deadline) === 0 ? "Due today" : `${daysUntil(scholarship.deadline)} days left`} · ${escapeHtml(formatDate(scholarship.deadline))}</strong></div>`).join("") : "<p>No active deadline reminders. Turn one on from a scholarship card.</p>"}<p>Reminders appear here when you sign in; this server does not send email or push notifications.</p>`;
}

function renderAll() {
  renderProfile();
  renderOverview();
  renderScholarships();
  renderApplications();
  renderDocuments();
  renderReminders();
  if (user.role === "admin") renderAdmin();
}

async function refreshStudentData() {
  const [profileResponse, scholarshipResponse, applicationResponse, documentResponse, reminderResponse] = await Promise.all([
    request("/api/profile"),
    request("/api/scholarships"),
    request("/api/applications"),
    request("/api/documents"),
    request("/api/reminders"),
  ]);
  profile = profileResponse.profile;
  scholarships = scholarshipResponse.scholarships;
  applications = applicationResponse.applications;
  uploadedDocuments = documentResponse.documents;
  reminders = reminderResponse.reminders;
}

async function refreshAdminData() {
  const [applicationsResponse, documentsResponse] = await Promise.all([
    request("/api/admin/applications"),
    request("/api/admin/documents"),
  ]);
  adminApplications = applicationsResponse.applications;
  adminDocuments = documentsResponse.documents;
}

async function openWorkspace(account) {
  user = account.user;
  profile = account.profile || {};
  document.getElementById("auth-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  setRoleNavigation();
  if (user.role === "admin") {
    await refreshAdminData();
    setView("admin");
  } else {
    await refreshStudentData();
    setView("overview");
  }
  renderAll();
}

async function applyForScholarship(id) {
  try {
    await request("/api/applications", { method: "POST", body: JSON.stringify({ scholarshipId: id }) });
    await refreshStudentData();
    renderAll();
    showToast("Application submitted. Track its status in My applications.");
  } catch (error) {
    showToast(error.message);
    if (error.message.includes("Upload the required documents")) setView("documents");
    if (error.message.includes("Complete your personal")) setView("profile");
  }
}

document.addEventListener("click", async (event) => {
  const authTab = event.target.closest("[data-auth-mode]");
  if (authTab) {
    setAuthMode(authTab.dataset.authMode);
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton && user) {
    setView(viewButton.dataset.view);
    return;
  }
  const applyButton = event.target.closest("[data-apply]");
  if (applyButton) {
    await applyForScholarship(applyButton.dataset.apply);
    return;
  }
  const reminderButton = event.target.closest("[data-reminder]");
  if (reminderButton) {
    const id = reminderButton.dataset.reminder;
    const scholarship = scholarships.find((item) => item.id === id);
    if (!scholarship) return;
    try {
      await request(`/api/reminders/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ active: !scholarship.reminderActive }),
      });
      await refreshStudentData();
      renderAll();
      showToast(scholarship.reminderActive ? "Deadline reminder turned off." : "Deadline reminder turned on.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (event.target.closest("#notification-button")) {
    const popover = document.getElementById("reminder-popover");
    popover.hidden = !popover.hidden;
    return;
  }
  const reviewDocument = event.target.closest("[data-review-document]");
  if (reviewDocument) {
    const id = reviewDocument.dataset.reviewDocument;
    const status = document.querySelector(`[data-document-status="${CSS.escape(id)}"]`).value;
    const reviewNote = document.querySelector(`[data-document-note="${CSS.escape(id)}"]`).value.trim();
    try {
      await request(`/api/admin/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote }),
      });
      await refreshAdminData();
      renderAdmin();
      showToast("Document review saved.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (event.target.closest("#signout-button")) {
    try {
      await request("/api/auth/logout", { method: "POST" });
      csrfToken = "";
      scholarships = [];
      applications = [];
      uploadedDocuments = [];
      reminders = [];
      adminApplications = [];
      adminDocuments = [];
      showAuth();
      await ensureCsrfToken();
      showToast("You have signed out.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (!event.target.closest("#reminder-popover")) document.getElementById("reminder-popover").hidden = true;
});

document.addEventListener("change", async (event) => {
  const review = event.target.closest("[data-review-application]");
  if (!review) return;
  try {
    await request(`/api/admin/applications/${encodeURIComponent(review.dataset.reviewApplication)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: review.value }),
    });
    await refreshAdminData();
    renderAdmin();
    showToast("Application status updated.");
  } catch (error) {
    showToast(error.message);
    await refreshAdminData();
    renderAdmin();
  }
});

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = document.getElementById("auth-submit");
  button.disabled = true;
  document.getElementById("auth-error").textContent = "";
  try {
    const payload = authMode === "register"
      ? await request("/api/auth/register", { method: "POST", body: JSON.stringify({ fullName: data.get("fullName"), email: data.get("email"), password: data.get("password") }) })
      : await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
    await openWorkspace(payload);
  } catch (error) {
    document.getElementById("auth-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const updated = {};
  for (const field of PROFILE_FIELDS) {
    if (!form.elements.namedItem(field)) continue;
    const value = formData.get(field);
    updated[field] = ["familyMembers", "annualIncome", "enrollmentYear", "expectedGraduation", "marks"].includes(field)
      ? (value === "" ? null : Number(value))
      : String(value || "").trim();
  }
  const message = document.getElementById("profile-save-message");
  message.textContent = "";
  try {
    const response = await request("/api/profile", { method: "PUT", body: JSON.stringify(updated) });
    profile = response.profile;
    await refreshStudentData();
    renderAll();
    message.textContent = "Profile saved.";
    showToast("Your profile and matches are up to date.");
  } catch (error) {
    message.textContent = error.message;
  }
});

document.getElementById("document-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorLabel = document.getElementById("upload-error");
  errorLabel.textContent = "";
  const selectedFile = form.elements.namedItem("document").files[0];
  if (!selectedFile) {
    errorLabel.textContent = "Choose a PDF, JPEG, or PNG document.";
    return;
  }
  if (selectedFile.size > 5 * 1024 * 1024) {
    errorLabel.textContent = "Each document must be 5 MB or smaller.";
    return;
  }
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const response = await request("/api/documents", { method: "POST", body: new FormData(form) });
    uploadedDocuments = [response.document, ...uploadedDocuments];
    await refreshStudentData();
    renderAll();
    form.reset();
    showToast("Document uploaded and added to the verification queue.");
  } catch (error) {
    errorLabel.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

["scholarship-search", "eligibility-filter", "sort-scholarships"].forEach((id) => {
  const element = document.getElementById(id);
  element.addEventListener(id === "scholarship-search" ? "input" : "change", renderScholarships);
});

async function ensureCsrfToken() {
  const result = await request("/api/auth/csrf");
  csrfToken = result.csrfToken;
}

async function initialize() {
  try {
    await ensureCsrfToken();
    const account = await request("/api/auth/me");
    if (!account.user) {
      showAuth();
      return;
    }
    await openWorkspace(account);
  } catch (error) {
    showAuth();
    document.getElementById("auth-error").textContent = `Could not connect to ScholarMatch. Start the server and refresh: ${error.message}`;
  }
}

initialize();
