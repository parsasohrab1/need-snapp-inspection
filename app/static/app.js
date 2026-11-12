const OFFER_STATUS = {
  pending: "منتظر تأیید",
  accepted: "تأیید کرد و اعزام شد",
  lost: "بازرس دیگری زودتر تأیید کرد",
  declined: "رد کرد",
  expired: "مهلت تمام شد",
};

const STATUS = {
  planned: "برنامه‌ریزی‌شده",
  ready: "آماده اعزام",
  offering: "پیشنهاد نزد بازرس",
  assigned: "پذیرفته‌شده",
  en_route: "در مسیر",
  on_site: "در محل",
  submitted: "در انتظار بررسی هماهنگ‌کننده",
  accepted: "تأیید شده",
};

const ROLE_LABEL = {
  admin: "مدیر سامانه",
  coordinator: "هماهنگ‌کننده اعزام",
  manager: "مدیر پروژه",
  executive_manager: "مدیر اجرایی",
  unit_manager: "مدیر واحد",
  buyer: "کارفرما",
  vendor: "سازنده",
  inspector: "بازرس",
};

const app = document.querySelector("#app");
const state = { me: null, view: "desk", viewHistory: [], formReturnView: "desk", inRequestMode: false, visitReportId: null, buyerRequestPanels: [false, false], toast: "", pointId: null, draft: {}, caption: "شاهد کارگاهی", kind: "project", formKind: "ivr", formId: null, formSpec: null, requestPointId: null, requestPoints: [], requestPrefill: null, requestCustomerLocation: null, formDraft: null, managerTab: "overview", inRegistrySearches: [{ search: "", filter: "all" }, { search: "", filter: "all" }], calendarOffset: 0, deskTimer: 0 };

function navigateTo(view) {
  if (state.view === view) return;
  state.viewHistory.push(state.view);
  state.view = view;
}

function resetFormState() {
  state.inRequestMode = false;
  state.visitReportId = null;
  state.formId = null;
  state.formDraft = null;
  state.requestPointId = null;
  state.requestPoints = [];
  state.requestPrefill = null;
  state.requestCustomerLocation = null;
}

function goBack() {
  const rootView = state.me?.role === "inspector" ? "dispatch" : "desk";
  const previousView = state.viewHistory.pop()
    || (state.view === "forms" ? state.formReturnView : rootView);
  if (state.view === "forms") resetFormState();
  state.view = previousView === state.view ? rootView : previousView;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function money(value) {
  return `${Number(value || 0).toLocaleString("fa-IR")} ریال`;
}

function currentLocation() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("مرورگر شما از موقعیت جغرافیایی پشتیبانی نمی‌کند."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (error) => {
        const messages = {
          1: "اجازه دسترسی به موقعیت را در مرورگر فعال کنید.",
          2: "موقعیت فعلی دریافت نشد؛ GPS یا خدمات مکان‌یابی را بررسی کنید.",
          3: "دریافت موقعیت بیش از حد طول کشید؛ دوباره تلاش کنید.",
        };
        reject(new Error(messages[error.code] || "دریافت موقعیت جغرافیایی ناموفق بود."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      const node = document.querySelector(".toast");
      if (node) node.remove();
    }
  }, 4200);
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.detail || "درخواست انجام نشد");
  return data;
}

const DISC = {
  material: "مواد",
  welding: "جوش",
  ndt: "آزمون غیرمخرب",
  mechanical: "مکانیک",
  hydrotest: "هیدروتست",
  coating: "پوشش",
  documentation: "مدارک",
};

const DOC_TYPES = {
  drawing: "نقشه ساخت",
  mtc: "گواهی مواد",
  wps: "WPS",
  pqr: "PQR",
  ndt_procedure: "رویه NDT",
  test_procedure: "رویه آزمون",
  coating_spec: "مشخصات پوشش",
  packing_list: "پکینگ‌لیست",
  purchase_order: "سفارش خرید",
  origin_certificate: "گواهی مبدأ",
  model_3d: "مدل سه‌بعدی",
};

const IN_EN = {
  "شناسه": "Identification",
  "مشاهده": "Inspection details",
  "امضا": "Sign-off",
  "موقعیت کارفرما": "Employer location",
  "کارفرما": "Client",
  "شماره IN": "IN number",
  "تاریخ": "Date",
  "پروژه": "Project",
  "شماره سفارش": "Purchase order number",
  "شماره PI": "P/I number",
  "پیمانکار": "Contractor",
  "فروشنده": "Vendor",
  "سازنده": "Manufacturer",
  "کد MC": "MC",
  "تاریخ بازرسی": "Inspection date",
  "مدت زمان بازرسی": "Inspection duration",
  "نماینده فروشنده": "Vendor's Representative",
  "شماره همراه": "Mobile No.",
  "تلفن تماس": "Contact Phone No.",
  "نشانی ایمیل": "Email Address",
  "محل": "Location",
  "شهر محل بازرسی": "Inspection City",
  "نشانی دقیق محل بازرسی": "Inspection Address",
  "کد پروژه": "Project Code",
  "تگ تجهیز": "Equipment tag",
  "ردیف ITP": "ITP item",
  "نام بازرس": "Inspector",
  "تخصص": "Discipline",
  "مدرک مرجع": "Reference document",
  "مدارک مرجع": "Reference documents",
  "مواد و اقلام": "Materials and items",
  "دامنه بازرسی": "Inspection scope",
  "نوع: اطلاعات / پانچ / Hold": "Type: information / punch / hold",
  "متن یادداشت": "Observation",
  "اقدام بعدی": "Follow-up action",
  "مهلت اعلام قبلی": "Advance notice period",
  "توضیحات تکمیلی": "Additional remarks",
  "نام و امضای بازرس": "Inspector name and signature",
  "تاریخ امضا": "Signature date",
  "تأییدکننده و شرکت": "Acknowledged by and company",
  "تاریخ تأیید": "Acknowledgment date",
};

function localizeInSheet(sheet) {
  const copy = JSON.parse(JSON.stringify(sheet));
  copy.title_fa = copy.title;
  copy.note = "Complete all applicable details. The inspection request follows the approval workflow.";
  copy.sections = copy.sections.map((section) => ({
    ...section,
    title: IN_EN[section.title] || section.title,
    fields: section.fields
      .filter((field) => !sheet.tables?.some((table) => table.key === field.key))
      .map((field) => ({ ...field, label: IN_EN[field.label] || field.label })),
  }));
  copy.tables = (sheet.tables || []).map((table) => ({
    ...table,
    title: table.key === "reference_documents" ? "Reference Documents" : table.key === "materials" ? "Extra Information & Remarks" : table.key === "items" ? "Item Description" : table.title,
    columns: table.columns.map((column) => ({
      ...column,
      label: ({
        title: "Document Title",
        document_no: "Document No.",
        issue_date: "Issue Date",
        revision: "Revision / Code",
        item_no: "Item No.",
        material: "Material Description",
        unit: "Unit",
        quantity: "Quantity",
        test_frequency: "Test Frequency",
        item: "Item Name",
        description: "Description",
      })[column.key] || column.label,
    })),
  }));
  return copy;
}

async function boot() {
  try {
    state.me = await api("/api/me");
    state.viewHistory = [];
    if (state.me.role === "inspector") state.view = "dispatch";
  } catch {
    state.me = null;
  }
  render();
}

function shell(title, subtitle, body) {
  const items = [
    ["desk", "میز کار"],
    ["registration", "ثبت‌نام"],
    ["dispatch", "اعزام"],
    ["docs", "مدارک"],
    ["moms", "صورتجلسه‌ها"],
    ["forms", "فرم‌ها"],
    ["notifications", "اعلان‌ها"],
    ["calendar", "تقویم"],
    ["archive", "آرشیو بازرسی"],
    ["people", state.me.role === "buyer" ? "بازرسی‌های انجام‌شده توسط این شرکت" : "بازرسان"],
    ["wallet", "تسویه"],
    ["benchmark", "بنچ‌مارک"],
    ["technology", "تکنولوژی"],
  ];
  const buyerItems = [
    ["desk", "میز کار"],
    ["buyer-new-in", "ثبت IN جدید"],
    ["buyer-new-international", "ثبت IN خارج از کشور"],
    ["buyer-in-list", "مشاهده INهای ثبت‌شده"],
    ["buyer-itp-new", "ثبت ITP جدید"],
    ["buyer-itp-list", "مشاهده ITPهای ثبت‌شده"],
    ["buyer-progress", "بازرسی‌های در حال انجام"],
    ["buyer-completed", "بازرسی‌های انجام‌شده"],
    ["buyer-status", "صورت‌وضعیت بازرسی"],
    ["buyer-date", "تبدیل تاریخ"],
    ["calendar", "تقویم"],
    ["docs", "مدارک پروژه"],
    ["moms", "صورتجلسه‌ها"],
    ["notifications", "اعلان‌ها"],
    ["buyer-bills", "صورت‌وضعیت و فاکتور"],
    ["archive", "آرشیو بازرسی"],
  ];
  const visibleItems = state.me.role === "buyer" ? buyerItems : items;
  if (state.me.role === "vendor") {
    const vendorItems = new Set(["desk", "docs", "notifications"]);
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      if (!vendorItems.has(visibleItems[index][0])) visibleItems.splice(index, 1);
    }
  }
  if (!["admin", "coordinator", "manager", "executive_manager"].includes(state.me.role)) {
    const registration = visibleItems.findIndex(([id]) => id === "registration");
    if (registration >= 0) visibleItems.splice(registration, 1);
  }
  if (state.me.role === "inspector") visibleItems.splice(2, 0, ["record", "کارنامه بازرسی"]);
  return `
    <div class="shell ${state.view === "forms" && state.inRequestMode && state.requestCustomerLocation === "international" ? "international-in-page" : ""}">
      <header class="app-header">
        <div class="app-brand"><img src="/static/logo.png" alt="تکین‌کو؛ شرکت بازرسی فنی و کنترل خوردگی"><span><b>اسنپ‌بازرس</b><small>بازرسی و کنترل کیفیت</small></span></div>
        <h1>${esc(title)}</h1>
        <div class="app-header-status"><span class="live-indicator"></span><span>سامانهٔ زنده</span></div>
      </header>
      <aside class="side">
        <div class="side-heading">${state.me.role === "buyer" ? "کارفرما" : esc(ROLE_LABEL[state.me.role] || "منوی اصلی")}</div>
        ${state.me.role === "buyer" ? `
          <div class="buyer-nav-group">
            ${visibleItems.slice(0, 6).map(([id, label]) => `<button class="navbtn ${state.view === id || (id === "buyer-new-international" && state.view === "forms" && state.requestCustomerLocation === "international") ? "active" : ""}" data-act="goto" data-view="${id}">${label}</button>`).join("")}
            <details class="buyer-nav-reports" open>
              <summary class="navbtn ${["buyer-progress", "buyer-completed", "buyer-status"].includes(state.view) ? "active" : ""}">گزارش بازرسی</summary>
              ${visibleItems.slice(6, 9).map(([id, label]) => `<button class="navbtn nav-sub ${state.view === id ? "active" : ""}" data-act="goto" data-view="${id}">${label}</button>`).join("")}
            </details>
            ${visibleItems.slice(9).map(([id, label]) => `<button class="navbtn ${state.view === id ? "active" : ""}" data-act="goto" data-view="${id}">${label}</button>`).join("")}
          </div>` : visibleItems.map(([id, label]) => `<button class="navbtn ${state.view === id ? "active" : ""}" data-act="goto" data-view="${id}">${label}</button>`).join("")}
        <div class="spacer"></div>
        <div class="who">${esc(state.me.name)}<br>${esc(ROLE_LABEL[state.me.role] || state.me.role)}${state.me.company ? `<br>${esc(state.me.company)}` : ""}</div>
        <button class="navbtn" data-act="logout">خروج</button>
      </aside>
      <section class="main ${state.view === "dispatch" ? "ride-main" : ""}">
        <div class="top">
          <div class="top-heading">
            <button class="back-button" data-act="back" aria-label="بازگشت به صفحه قبل" title="بازگشت به صفحه قبل" ${!state.viewHistory.length && state.view === (state.me.role === "inspector" ? "dispatch" : "desk") ? "disabled" : ""}><span aria-hidden="true">←</span><span>بازگشت</span></button>
            <div><h1>${title}</h1><p>${subtitle}</p></div>
          </div>
        </div>
        ${body}
      </section>
    </div>
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
}

function login() {
  const roles = [
    ["inspector.reza", "بازرس", "پذیرش اعزام و ثبت گزارش بازرسی"],
    ["buyer", "کارفرما", "ثبت فرم IN و پیگیری درخواست بازرسی"],
    ["manager", "مدیر پروژه", "بررسی درخواست و ارجاع به مدیر واحد"],
    ["coordinator", "هماهنگ‌کننده", "مدیریت اعزام و پیگیری گزارش‌ها"],
    ["unit.manager", "مدیر واحد", "تأیید تخصصی و ارسال پیشنهاد برای بازرس"],
  ];
  app.innerHTML = `
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}
    <div class="login">
      <section class="hero">
        <div class="login-brand"><img src="/static/logo.png" alt="تکین‌کو؛ شرکت بازرسی فنی و کنترل خوردگی"></div>
        <div class="login-hero-copy">
          <p class="login-slogan">کیفیت، اعتماد، توسعهٔ پایدار</p>
          <span class="hero-rule"></span>
          <h1>بازرسی هوشمند<br>برای صنعتی مطمئن</h1>
          <p>تمام مراحل بازرسی، از ثبت درخواست تا گزارش نهایی، در یک سامانهٔ یکپارچه و شفاف.</p>
        </div>
        <div class="login-features">
          <div><span>◇</span><b>کنترل کیفیت</b></div>
          <div><span>▤</span><b>گزارش‌گیری دقیق</b></div>
          <div><span>⇄</span><b>شفافیت و اعتماد</b></div>
          <div><span>⚙</span><b>مدیریت هوشمند</b></div>
        </div>
      </section>
      <section class="panel">
        <div class="login-form-wrap">
          <div class="login-form-heading"><span class="login-heading-icon">↪</span><h2>ورود به سامانه</h2></div>
          <p class="login-company">سامانهٔ یکپارچهٔ بازرسی فنی</p>
          <form id="login-form" class="login-form">
            <label class="login-field"><span>نام کاربری</span><span class="login-input-wrap"><input id="login-username" name="username" autocomplete="username" value="inspector.reza" required><b aria-hidden="true">♙</b></span></label>
            <label class="login-field"><span>رمز عبور</span><span class="login-input-wrap"><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="رمز عبور خود را وارد کنید" required><b aria-hidden="true">▣</b></span></label>
            <label class="login-field"><span>نقش کاربری</span><span class="login-role-wrap"><b aria-hidden="true">♟</b><select id="login-role" name="role" size="5" aria-label="انتخاب نقش کاربری">${roles.map(([user, name, description], index) => `<option value="${esc(user)}" data-description="${esc(description)}" ${index === 0 ? "selected" : ""}>${name}</option>`).join("")}</select></span></label>
            <p class="login-role-description">${esc(roles[0][2])}</p>
            <button class="login-submit" type="submit"><span>ورود</span><b aria-hidden="true">⇥</b></button>
            <p class="login-demo-hint">حساب نمایشی: گذرواژهٔ <bdi dir="ltr">demo1234</bdi></p>
          </form>
        </div>
      </section>
    </div>`;
  const roleSelect = document.querySelector("#login-role");
  roleSelect.addEventListener("change", () => {
    document.querySelector("#login-username").value = roleSelect.value;
    document.querySelector(".login-role-description").textContent = roleSelect.selectedOptions[0].dataset.description;
  });
}

async function loginWithCredentials() {
  const username = document.querySelector("#login-username")?.value.trim();
  const password = document.querySelector("#login-password")?.value;
  if (!username || !password) throw new Error("نام کاربری و رمز عبور را وارد کنید.");
  state.me = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  state.viewHistory = [];
  state.view = state.me.role === "inspector" ? "dispatch" : "desk";
  await render();
}

function ring(percent) {
  const radius = 46;
  const length = 2 * Math.PI * radius;
  const offset = length * (1 - Math.max(0, Math.min(percent, 100)) / 100);
  return `
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#e4eee6" stroke-width="12"></circle>
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#12824d" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${length.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 60 60)"></circle>
      <text x="60" y="56" text-anchor="middle" font-size="22" font-weight="700" fill="#143026">${percent.toLocaleString("fa-IR")}</text>
      <text x="60" y="76" text-anchor="middle" font-size="11" fill="#5d6b63">درصد</text>
    </svg>`;
}

function jobCard(row) {
  return `
    <button class="job" data-act="open-point" data-id="${row.id}">
      <span class="job-top">
        <span class="tag">${esc(row.tag)}</span>
        <span class="ptype p-${esc(row.point_type)}">${esc(row.point_type)}</span>
      </span>
      <b>${esc(row.title)}</b>
      <small>${esc(row.discipline_label)} · ${esc(STATUS[row.status] || row.status)}</small>
      ${state.me.role !== "buyer" && row.dispatch_label ? `<span class="assignee">${esc(row.dispatch_label)}</span>` : ""}
      ${state.me.role !== "buyer" && !row.assignee && row.offered && row.offered.length ? `<span class="assignee wait">منتظر تأیید: ${esc(row.offered.join("، "))}</span>` : ""}
      <span class="job-flags">
        ${row.ncr_open ? `<span class="chip bad">عدم انطباق</span>` : ""}
        ${row.missing_docs.length ? `<span class="chip wait">مدارک ناقص</span>` : ""}
        ${row.remote_requested ? `<span class="chip">راه دور</span>` : ""}
      </span>
    </button>`;
}

function column(title, tone, rows, limit) {
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return `
    <section class="col col-${tone}">
      <header><h3>${title}</h3><b>${rows.length.toLocaleString("fa-IR")}</b></header>
      ${shown.map(jobCard).join("") || `<p class="empty">این صف خالی است</p>`}
      ${rest > 0 ? `<p class="more">${rest.toLocaleString("fa-IR")} مورد دیگر در فهرست نقطه است</p>` : ""}
    </section>`;
}

function modeSwitch(modes) {
  const hint = {
    project: "چند تجهیز روی یک برنامه ITP",
    case: "یک قلم، جدا از برنامه پروژه",
  };
  return `<div class="modes">${(modes || []).map((item) => `
    <button class="mode ${state.kind === item.id ? "on" : ""}" data-act="kind" data-kind="${item.id}">
      <b>${esc(item.title)}</b>
      <small>${hint[item.id] || ""}</small>
      <em>${Number(item.points).toLocaleString("fa-IR")} نقطه · ${Number(item.accepted).toLocaleString("fa-IR")} تأیید شده</em>
    </button>`).join("")}</div>`;
}

function reportCard(row, actions) {
  return `
    <article class="picked ${row.result === "reject" ? "bad" : ""}">
      <button class="linkish" data-act="open-ivr" data-id="${row.visit_id}">
        <b>${esc(row.ivr_no)} · ${row.result === "reject" ? "رد" : "قبول"}</b>
        <small>${esc(row.tag)} · ${esc(row.title)} · ${esc(row.inspector)}</small>
        <em>${esc(row.defects[0] || row.note || "بدون ایراد")}</em>
      </button>
      ${actions || ""}
    </article>`;
}

function managerTray(reports) {
  const cards = (reports || []).map((row) => reportCard(row, `
    <div class="actions">
      ${row.result === "accept" ? `<button class="primary" data-act="review" data-id="${row.visit_id}" data-decision="approve">تأیید</button>` : ""}
      <button class="warn" data-act="review" data-id="${row.visit_id}" data-decision="return">برگرداندن</button>
    </div>`)).join("");
  return `<section class="card pad tray">
    <h3>کارتابل هماهنگ‌کننده / مدیر پروژه</h3>
    <p class="hint">گزارش بازرس همان لحظهٔ ثبت اینجا می‌نشیند. مغایرت برمی‌گردد و تأیید وارد کارتابل کارفرما می‌شود.</p>
    <div class="picked-list">${cards || `<p class="empty">گزارش تازه‌ای ننشسته است.</p>`}</div>
  </section>`;
}

function clientTray(reports) {
  const cards = (reports || []).map((row) => reportCard(row, `
    <div class="actions">
      ${row.request_form_id ? `<button class="ghost" data-act="open-sheet" data-id="${row.request_form_id}" data-kind="in">مشاهده فرم IN ثبت‌شده</button>` : ""}
      <button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">مشاهده گزارش و همه پیوست‌ها · ${Number(row.evidence_count || 0).toLocaleString("fa-IR")} فایل بازرسی · ${Number(row.document_count || 0).toLocaleString("fa-IR")} مدرک</button>
      <button class="primary" data-act="confirm-report" data-id="${row.visit_id}">تأیید کارفرما</button>
      <label>دلیل رد<input id="client-reject-note-${row.visit_id}" minlength="3" maxlength="2000" placeholder="در صورت رد، دلیل را بنویسید"></label>
      <button class="warn" data-act="client-reject-report" data-id="${row.visit_id}">رد گزارش</button>
    </div>`)).join("");
  return `<section class="card pad tray">
    <h3>درخواست‌های IN انجام‌شده · گزارش‌های تأییدشدهٔ مدیر پروژه</h3>
    <p class="hint">فرم IN ثبت‌شده، گزارش تکمیل‌شده، چک‌لیست، مدارک پروژه و همهٔ عکس‌ها و پیوست‌های بارگذاری‌شده را بازبینی کنید. تأیید نهایی، صورت‌وضعیت و فاکتور را صادر می‌کند.</p>
    <div class="picked-list">${cards || `<p class="empty">گزارش تأییدشده‌ای ننشسته است.</p>`}</div>
  </section>`;
}

function billBoard(bills) {
  const cards = (bills || []).map((bill) => `
    <article class="card pad bill">
      <div class="split">
        <h3>صورت‌وضعیت ${esc(bill.statement_no)}</h3>
        <span class="chip">${esc(bill.kind_label)}</span>
      </div>
      <p>فاکتور ${esc(bill.invoice_no)} · ${esc(bill.client)} · ${esc(bill.tag)} · ${esc(bill.title)}</p>
      <p class="hint">${esc(bill.ivr_no)} · ${esc(bill.company)}</p>
      <table class="bill-lines">
        <tbody>
          <tr><td>بهای بازرسی</td><td>${money(bill.gross_irr)}</td></tr>
          <tr><td>کسر حسن انجام تعهدات ${Number(bill.performance_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.performance_irr)}</td></tr>
          <tr><td>کسر سپرده بیمه ${Number(bill.insurance_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.insurance_irr)}</td></tr>
          <tr><td>مالیات تکلیفی ${Number(bill.tax_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.tax_irr)}</td></tr>
          <tr><td>افزودن ارزش افزوده ${Number(bill.vat_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.vat_irr)}</td></tr>
          <tr><td><b>خالص قابل پرداخت</b></td><td><b>${money(bill.net_irr)}</b></td></tr>
        </tbody>
      </table>
      <p><span class="chip ${bill.accounting_status === "returned" ? "bad" : bill.accounting_status === "overdue" ? "wait" : bill.accounting_status === "sent_to_accounting" ? "ok" : ""}">${esc({
        issued: "به ذی‌حسابی ارسال نشده",
        sent_to_accounting: "به ذی‌حسابی ارسال شده",
        returned: "مرجوع‌شده",
        overdue: "معوقه",
      }[bill.accounting_status] || bill.accounting_status)}</span></p>
      ${bill.accounting_note ? `<p class="hint">یادداشت وضعیت: ${esc(bill.accounting_note)}</p>` : ""}
      <div class="split claim-path">
        <span class="chip">وضعیت پرداخت</span>
        <span class="chip ${bill.claim_status === "paid" ? "ok" : bill.claim_status === "needs_correction" ? "bad" : "wait"}">${esc({
          unpaid: "پرداخت‌نشده",
          paid: "پرداخت‌شده",
          needs_correction: "نیازمند اصلاح",
        }[bill.claim_status] || "پرداخت‌نشده")}</span>
        <span class="hint">به‌روزرسانی: ${esc(bill.claim_updated_at ? faWhen(bill.claim_updated_at).date : "—")}</span>
      </div>
      ${bill.claim_note ? `<p class="hint">یادداشت Claim: ${esc(bill.claim_note)}</p>` : ""}
      <p class="hint">${esc(bill.basis)}</p>
      ${["manager", "admin"].includes(state.me.role) ? `
        <div class="archive-upload">
          <label>ارجاع به ذی‌حسابی
            <select id="bill-status-${bill.id}">
              ${[["issued", "ارسال نشده به ذی‌حسابی"], ["sent_to_accounting", "ارسال شده به ذی‌حسابی"]]
                .map(([value, label]) => `<option value="${value}" ${bill.accounting_status === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>توضیح<input id="bill-note-${bill.id}" value="${esc(bill.accounting_note)}"></label>
          <button class="ghost" data-act="update-bill-status" data-id="${bill.id}">ثبت وضعیت</button>
          <label>وضعیت پرداخت
            <select id="claim-status-${bill.id}">
              ${[["unpaid", "پرداخت‌نشده"], ["paid", "پرداخت‌شده"]]
                .map(([value, label]) => `<option value="${value}" ${bill.claim_status === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>توضیح پرداخت<input id="claim-note-${bill.id}" value="${esc(bill.claim_note)}"></label>
          <button class="ghost" data-act="update-claim-status" data-id="${bill.id}">ثبت وضعیت پرداخت</button>
        </div>` : ""}
    </article>`).join("");
  return `<section class="bills">
    <h3>صورت‌وضعیت و فاکتور</h3>
    ${cards || `<article class="card pad"><p class="empty">پس از تأیید نهایی بازرسی، صورت‌وضعیت اینجا برای کارفرما می‌نشیند.</p></article>`}
  </section>`;
}

function faWhen(iso) {
  if (!iso) return { date: "—", time: "—" };
  const value = new Date(String(iso).replace(" ", "T"));
  if (Number.isNaN(value.getTime())) return { date: String(iso).slice(0, 10), time: String(iso).slice(11, 16) };
  return {
    date: value.toLocaleDateString("fa-IR"),
    time: value.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function faDigits(value) {
  return String(value || "—").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

function recordTable(rows) {
  const body = (rows || []).map((row) => {
    const when = faWhen(row.at);
    return `<tr>
      <td>${esc(when.time)}</td>
      <td>${esc(when.date)}</td>
      <td>${esc(row.company)}</td>
      <td>${esc(row.client)}</td>
      <td>${esc(faDigits(row.window))}</td>
      <td>${esc(row.ivr_no)}</td>
      <td>${esc(row.tag)} · ${esc(row.title)}</td>
      <td>${esc(row.workshop)}</td>
      <td>${esc(row.discipline)}</td>
      <td><button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">گزارش</button></td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap"><table class="record">
    <thead><tr>
      <th>زمان</th><th>تاریخ</th><th>نام شرکت</th><th>نام کارفرما</th><th>بازه زمانی بازرسی</th><th>شماره گزارش</th><th>موضوع</th><th>کارگاه</th><th>رشته</th><th></th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="10">پس از تأیید کارفرما، بازرسی‌های انجام‌شده اینجا می‌نشیند.</td></tr>`}</tbody>
  </table></div>`;
}

function managerInspectionList(rows, emptyText) {
  return `<div class="picked-list">${rows.map((row) => `
    <button class="picked" data-act="${row.visit_id ? "open-ivr" : "open-point"}" data-id="${row.visit_id || row.point_id}">
      <b>${esc(row.tag)} · ${esc(row.title)}</b>
      <small>${esc(row.project)} · ${esc(row.inspector || "بازرس تخصیص نیافته")} · ${esc(STATUS[row.status] || row.status)}</small>
      ${row.reason ? `<em>${esc(row.reason)}</em>` : ""}
    </button>`).join("") || `<p class="empty">${emptyText}</p>`}</div>`;
}

function managerTabButton(key, label, active) {
  return `<button class="ghost ${active === key ? "active" : ""}" data-act="manager-tab" data-tab="${key}">${label}</button>`;
}

function itpProjectChart(projects) {
  const maximum = Math.max(1, ...projects.map((project) => Number(project.itp_count || 0)));
  return `<article class="card pad">
    <h3>نمودار تعداد ITP به تفکیک پروژه</h3>
    <p class="hint">هر ITP مربوط به یک تجهیز دارای نقاط بازرسی است؛ تعداد ردیف‌های آن نیز در جدول پروژه‌ها آمده است.</p>
    <div class="itp-chart" role="img" aria-label="نمودار تعداد ITP به تفکیک پروژه">
      ${projects.map((project) => {
        const count = Number(project.itp_count || 0);
        const width = Math.max(0, Math.round((count / maximum) * 100));
        return `<div class="itp-chart-row">
          <span>${esc(project.code)} · ${esc(project.name)}</span>
          <div class="itp-chart-track"><i style="width:${width}%"></i></div>
          <b>${count.toLocaleString("fa-IR")}</b>
        </div>`;
      }).join("") || `<p class="empty">پروژه‌ای برای نمایش در نمودار ثبت نشده است.</p>`}
    </div>
  </article>`;
}

function requestStatusLabel(status) {
  return ({
    manager_review: "دریافت از کارفرما · در انتظار بررسی مدیر پروژه",
    unit_review: "ارسال به مدیر واحد · در انتظار بررسی",
    inspection_queue: "ارسال به اسنپ · جست‌وجوی بازرس",
    approved: "ارسال به اسنپ · در انتظار پذیرش بازرس",
    approved_no_inspector: "ارسال به اسنپ · بازرس واجدشرایط آنلاین نیست",
    documents_missing: "نقص مدارک · برگشت برای تکمیل",
    returned: "مرجوع به کارفرما برای اصلاح",
  }[status] || status);
}

function filterInRegistry(registry) {
  if (!registry) return;
  const search = registry.querySelector("[data-in-search]");
  const filter = registry.querySelector("[data-in-filter]");
  const registryIndex = [...app.querySelectorAll(".in-registry")].indexOf(registry);
  if (registryIndex >= 0) {
    state.inRegistrySearches[registryIndex] = { search: search?.value || "", filter: filter?.value || "all" };
  }
  const query = search?.value.trim().toLocaleLowerCase("fa-IR") || "";
  const field = filter?.value || "all";
  const fields = field === "all" ? ["date", "number", "buyer", "project", "point", "status"] : [field];
  const rows = [...registry.querySelectorAll("[data-in-row]")];
  let visible = 0;
  rows.forEach((row) => {
    const matches = !query || fields.some((key) => (row.dataset[key] || "").toLocaleLowerCase("fa-IR").includes(query));
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = registry.querySelector(".registry-no-results");
  if (empty) empty.hidden = visible > 0;
  const count = registry.querySelector(".registry-count");
  if (count) count.textContent = `${visible.toLocaleString("fa-IR")} از ${rows.length.toLocaleString("fa-IR")} درخواست`;
}

function managerInRequests(forms) {
  const received = forms.filter((form) => form.request_status === "manager_review");
  const sent = forms.filter((form) => !["manager_review", "draft"].includes(form.request_status));
  const table = (rows, empty, index) => {
    const saved = state.inRegistrySearches[index] || { search: "", filter: "all" };
    return `<div class="in-registry">
    <div class="registry-toolbar">
      <label class="registry-search"><span aria-hidden="true">⌕</span><input type="search" data-in-search value="${esc(saved.search)}" placeholder="جست‌وجو در INهای ثبت‌شده…" aria-label="جست‌وجو در INهای ثبت‌شده"></label>
      <label class="registry-filter"><span>جست‌وجو بر اساس</span><select data-in-filter aria-label="فیلتر فهرست IN">
        <option value="all" ${saved.filter === "all" ? "selected" : ""}>همهٔ موارد</option><option value="date" ${saved.filter === "date" ? "selected" : ""}>تاریخ</option><option value="number" ${saved.filter === "number" ? "selected" : ""}>شماره IN</option>
        <option value="buyer" ${saved.filter === "buyer" ? "selected" : ""}>کارفرما</option><option value="project" ${saved.filter === "project" ? "selected" : ""}>پروژه</option><option value="point" ${saved.filter === "point" ? "selected" : ""}>تجهیز / نقطه</option><option value="status" ${saved.filter === "status" ? "selected" : ""}>وضعیت</option>
      </select></label>
      <span class="registry-count">${rows.length.toLocaleString("fa-IR")} درخواست</span>
    </div>
    <div class="tablewrap"><table class="in-table"><thead><tr><th>وضعیت</th><th>نام کارفرما</th><th>پروژه</th><th>تاریخ</th><th>شماره IN</th><th>اقدام</th></tr></thead><tbody>
      ${rows.map((form) => `<tr data-in-row data-date="${esc(form.date || "")}" data-number="${esc(form.number || "")}" data-buyer="${esc(form.buyer)}" data-project="${esc(form.project)}" data-point="${esc(`${form.tag} ${form.title}`)}" data-status="${esc(requestStatusLabel(form.request_status))}">
        <td><span class="request-status">${esc(requestStatusLabel(form.request_status))}</span></td>
        <td>${esc(form.buyer)}</td><td>${esc(form.project)}</td><td dir="ltr">${esc(form.date || "—")}</td><td dir="ltr">${esc(form.number || "—")}</td>
        <td><div class="registry-actions"><button class="ghost" data-act="open-sheet" data-id="${form.form_id}" data-kind="in">مشاهده IN</button><button class="ghost" data-act="open-point" data-id="${form.point_id}">جزئیات</button></div></td>
      </tr>`).join("") || `<tr><td colspan="6">${empty}</td></tr>`}
      <tr class="registry-no-results" hidden><td colspan="6">موردی با این جست‌وجو پیدا نشد.</td></tr>
    </tbody></table></div>
  </div>`;
  };
  return `<section class="grid2">
    <article class="card pad">
      <h3>دریافت IN از کارفرما <span class="chip">${received.length.toLocaleString("fa-IR")}</span></h3>
      <p class="hint">پس از بررسی فرم و ثبت مهر و امضای مدیر پروژه، درخواست به کارتابل مدیر واحد منتقل می‌شود.</p>
      ${table(received, "درخواست جدیدی از کارفرما در انتظار بررسی نیست.", 0)}
    </article>
    <article class="card pad">
      <h3>ارسال IN به مدیر واحد و مراحل بعد <span class="chip">${sent.length.toLocaleString("fa-IR")}</span></h3>
      <p class="hint">وضعیت درخواست‌های ارجاع‌شده به مدیر واحد و درخواست‌هایی که پس از تأیید او وارد اسنپ شده‌اند.</p>
      ${table(sent, "هنوز درخواستی از مرحلهٔ مدیر پروژه عبور نکرده است.", 1)}
    </article>
  </section>`;
}

function managerDispatchList(rows) {
  return `<div class="picked-list">${rows.map((row) => `
    <button class="picked" data-act="open-point" data-id="${row.point_id}">
      <b>${esc(row.inspector || "در انتظار پذیرش بازرس")}</b>
      <small>${esc(row.project_code)} · ${esc(row.project)} · ${esc(row.tag)} · ${esc(row.title)}</small>
      <em>${esc(row.dispatch_sentence || `وضعیت: ${STATUS[row.status] || row.status}`)}</em>
      ${row.offered?.length ? `<small>پیشنهاد نزد: ${esc(row.offered.join("، "))}</small>` : ""}
    </button>`).join("") || `<p class="empty">اعزام فعالی وجود ندارد.</p>`}</div>`;
}

function buyerRequestTray(board) {
  const eligible = board.filter((row) =>
    ["draft", "documents_missing", "returned"].includes(row.request_status)
  );
  const requests = board.filter((row) => row.request_status !== "draft");
  const requestStatus = {
    documents_missing: "نقص مدارک",
    manager_review: "در انتظار بررسی مدیر پروژه",
    unit_review: "در انتظار بررسی مدیر واحد",
    executive_review: "در انتظار بررسی مدیر اجرایی",
    inspection_queue: "در کارتابل بازرسی",
    approved: "تأیید و ارسال به بازرس",
    approved_no_inspector: "تأییدشده؛ در انتظار بازرس",
    returned: "مرجوع‌شده؛ نیازمند اصلاح",
  };
  return `<section class="card pad">
    <h3>درخواست‌های بازرسی کارفرما</h3>
    <p class="hint">برای درخواست تازه، فرم خام IN را تکمیل و ارسال کنید. درخواست‌های ارسال‌شده برای پیگیری و مشاهدهٔ فرم ثبت‌شده در این بخش می‌مانند.</p>
    <div class="buyer-request-panels">
      <details class="buyer-request-box" ${state.buyerRequestPanels[0] ? "open" : ""}>
        <summary><span>فرم‌های IN ارسال‌شده به مدیر پروژه</span><span class="chip">${requests.length.toLocaleString("fa-IR")}</span></summary>
        <div class="buyer-request-list">${requests.map((row) => `
          <div class="person">
            <span>${esc(row.tag)} · ${esc(row.title)}<small>${esc(row.project_name)} · ${esc(requestStatus[row.request_status] || row.request_status)}</small></span>
            <span class="actions">
              ${row.request_form_id ? `<button class="ghost" data-act="open-sheet" data-id="${row.request_form_id}" data-kind="in">مشاهده فرم IN</button>` : ""}
              <button class="ghost" data-act="open-point" data-id="${row.id}">پیگیری درخواست</button>
            </span>
          </div>`).join("") || `<p class="empty">هنوز درخواستی ثبت نشده است.</p>`}</div>
      </details>
      <details class="buyer-request-box" ${state.buyerRequestPanels[1] ? "open" : ""}>
        <summary><span>فرم خام · ثبت درخواست IN جدید</span><span class="chip">${eligible.length.toLocaleString("fa-IR")}</span></summary>
        <div class="buyer-request-list">
          <p>فرم خام پس از انتخاب نقطه تکمیل می‌شود؛ با ثبت نهایی، فرم به کارتابل مدیر پروژه ارسال خواهد شد.</p>
          <button class="primary" data-act="begin-in-request" ${eligible.length ? "" : "disabled"}>انتخاب نقطه و تکمیل فرم خام IN</button>
        </div>
      </details>
    </div>
  </section>`;
}

function inRequestPointChooser(board, selectedId) {
  const eligible = board.filter((row) =>
    ["draft", "documents_missing", "returned"].includes(row.request_status)
  );
  const grouped = new Map();
  eligible.forEach((row) => {
    const points = grouped.get(row.tag) || [];
    points.push(row);
    grouped.set(row.tag, points);
  });
  const selected = eligible.find((row) => row.id === selectedId);
  return `<details class="in-point-chooser" ${selected ? "" : "open"}>
    <summary>${selected
      ? `نقطهٔ انتخاب‌شده: ${esc(selected.tag)} · ${esc(selected.title)} — انتخاب نقطهٔ دیگر`
      : "انتخاب تجهیز و نقطهٔ بازرسی"}
    </summary>
    <p class="hint">ابتدا یک نقطه انتخاب کنید. فهرست به تفکیک تجهیز باز می‌شود.</p>
    ${[...grouped.entries()].map(([tag, points]) => `<details class="in-equipment-options">
      <summary>${esc(tag)} · ${esc(points[0].equipment)} <span class="chip">${points.length.toLocaleString("fa-IR")} نقطه</span></summary>
      <div class="in-point-options">${points.map((row) => `
        <button class="in-point-option ${row.id === selectedId ? "selected" : ""}" data-act="select-in-point" data-id="${row.id}">
          <b>${esc(row.title)}</b>
          <small>${esc(row.project_name)} · ${esc(row.discipline_label)} · ${esc(row.request_status === "draft" ? "آماده ثبت IN" : row.request_status === "returned" ? "مرجوع‌شده برای اصلاح" : "نقص مدارک")}</small>
        </button>`).join("")}</div>
    </details>`).join("") || `<p class="empty">نقطه‌ای برای ثبت IN موجود نیست.</p>`}
  </details>`;
}

async function renderManagerDesk() {
  const kindQuery = state.me.role === "manager" ? `?kind=${encodeURIComponent(state.kind)}` : "";
  const data = await api(`/api/manager/desk${kindQuery}`);
  const people = data.inspectors || [];
  const bills = data.statements || [];
  const activeTab = state.managerTab || "overview";
  const tabs = [
    ["overview", "نمای کلی"],
    ["dispatch", "اعزام و بازرس منتخب"],
    ["performed", "بازرسی‌های انجام‌شده"],
    ["completed", "تأییدشده توسط کارفرما"],
    ["review", "در انتظار بررسی گزارش"],
    ["rejected", "ردشده‌ها و دلیل رد"],
    ["missing", "نواقص مدارک"],
    ["unfinished", "انجام‌نشده / معوقه"],
    ["requests", "مشاهده INهای ثبت‌شده"],
    ["claims", "صورت‌وضعیت و Claim"],
  ];
  const bodyByTab = {
    overview: `<section class="grid2">
      <article class="card pad"><h3>فهرست کارفرماها</h3>${(data.clients || []).map((client) => `<div class="person"><span>${esc(client.name)}</span></div>`).join("") || `<p class="empty">کارفرمایی ثبت نشده است.</p>`}</article>
      <article class="card pad"><h3>فهرست پروژه‌ها و تعداد ITP</h3><div class="tablewrap"><table><thead><tr><th>کد</th><th>پروژه</th><th>کارفرما</th><th>تعداد ITP</th><th>ردیف‌های ITP</th><th>ناقص</th><th>انجام‌نشده</th></tr></thead><tbody>
        ${(data.projects || []).map((project) => `<tr><td>${esc(project.code)}</td><td>${esc(project.name)}</td><td>${esc(project.buyer)}</td><td>${Number(project.itp_count || 0).toLocaleString("fa-IR")}</td><td>${Number(project.itp_point_count || project.inspection_count || 0).toLocaleString("fa-IR")}</td><td>${project.incomplete_count.toLocaleString("fa-IR")}</td><td>${project.not_done_count.toLocaleString("fa-IR")}</td></tr>`).join("") || `<tr><td colspan="7">پروژه‌ای ثبت نشده است.</td></tr>`}
      </tbody></table></div></article>
    </section>
    ${itpProjectChart(data.projects || [])}
    <article class="card pad"><h3>بازرس‌های شرکت</h3><div class="tablewrap"><table><thead><tr><th>نام</th><th>شهر</th><th>موقعیت (عرض، طول)</th><th>وضعیت</th><th>تخصص</th></tr></thead><tbody>
      ${people.map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.city)}</td><td dir="ltr">${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}</td><td>${person.online ? "آنلاین" : "آفلاین"}</td><td>${esc((person.discipline_labels || []).join("، "))}</td></tr>`).join("") || `<tr><td colspan="5">بازرسی ثبت نشده است.</td></tr>`}
    </tbody></table></div></article>`,
    performed: `<article class="card pad"><h3>بازرسی‌های انجام‌شده توسط شرکت</h3>${managerInspectionList(data.performed_reports || [], "گزارش بازرسی ثبت‌شده‌ای وجود ندارد.")}</article>`,
    dispatch: `<article class="card pad"><h3>بازرس انتخاب‌شده برای اعزام</h3>${managerDispatchList(data.selected_for_dispatch || [])}</article>`,
    completed: `<article class="card pad"><h3>بازرسی‌های تأییدشده توسط کارفرما</h3>${managerInspectionList((data.approved_reports || []).filter((row) => row.client_approved_at), "بازرسی تأییدشده‌ای وجود ندارد.")}</article>`,
    review: `<article class="card pad"><h3>گزارش‌های در انتظار بررسی</h3><p class="hint">برای بازبینی گزارش، جزئیات بازرسی را باز کنید.</p>${managerInspectionList(data.awaiting_report_review || [], "گزارشی در انتظار بررسی نیست.")}</article>`,
    rejected: `<article class="card pad"><h3>بازرسی‌های ردشده</h3>${managerInspectionList(data.rejected_reports || [], "گزارش ردشده‌ای وجود ندارد.")}</article>`,
    missing: `<article class="card pad"><h3>نواقص مدارک بازرسی</h3>${managerInspectionList((data.missing_documents || []).map((row) => ({ ...row, reason: row.missing_docs.join("، ") })), "مدرک ناقصی ثبت نشده است.")}</article>`,
    unfinished: `<section class="grid2">
      <article class="card pad"><h3>بازرسی‌های انجام‌شده با نقص</h3>${managerInspectionList(data.incomplete_inspections || [], "مورد ناقصی وجود ندارد.")}</article>
      <article class="card pad"><h3>بازرسی‌های انجام‌نشده</h3>${managerInspectionList(data.not_done_inspections || [], "بازرسی انجام‌نشده‌ای وجود ندارد.")}</article>
    </section>`,
    requests: managerInRequests(data.in_forms || []),
    claims: billBoard(bills),
  };
  app.innerHTML = shell(
    state.me.role === "manager" ? "میز کار مدیر پروژه" : "میز کار مدیر اجرایی",
    "دریافت IN از کارفرما، ارسال مرحله‌ای به مدیر واحد و اسنپ، گزارش‌ها و مسیر مالی پرونده‌ها.",
    `<div class="desk">
      <section class="kpis">
        <article class="kpi"><span>کارفرماها</span><strong>${(data.clients || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi"><span>پروژه‌ها</span><strong>${(data.projects || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi tone-red"><span>بازرسی‌های ناقص</span><strong>${(data.incomplete_inspections || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi tone-amber"><span>بازرسی‌های انجام‌نشده</span><strong>${(data.not_done_inspections || []).length.toLocaleString("fa-IR")}</strong></article>
      </section>
      <section class="actions">${state.me.role === "manager" ? modeSwitch(data.modes) : ""}${tabs.map(([key, label]) => managerTabButton(key, label, activeTab)).join("")}</section>
      ${bodyByTab[activeTab] || bodyByTab.overview}
    </div>`
  );
  if (activeTab === "requests") {
    app.querySelectorAll(".in-registry").forEach(filterInRegistry);
  }
  clearTimeout(state.deskTimer);
  state.deskTimer = setTimeout(() => {
    if (state.view === "desk" && ["manager", "executive_manager"].includes(state.me?.role)) render();
  }, 6000);
}

async function renderUnitManagerDesk() {
  const data = await api("/api/unit-manager/desk");
  app.innerHTML = shell(
    "کارتابل مدیر واحد",
    "دریافت IN از مدیر پروژه، تأیید و ارسال زنده به اسنپ برای یافتن بازرس",
    `<section class="grid2">
    <article class="card pad"><h3>دریافت IN از مدیر پروژه <span class="chip">${(data.requests || []).length.toLocaleString("fa-IR")}</span></h3><p class="hint">درخواست را بررسی کنید؛ پس از ثبت مهر و امضا، سامانه آن را برای یافتن بازرس به اسنپ ارسال می‌کند.</p><div class="picked-list">${(data.requests || []).map((request) => `
      <div class="card pad">
        <h3>${esc(request.tag)} · ${esc(request.title)}</h3>
        <p>${esc(request.buyer)} · ${esc(request.project)} · واحد ${esc(request.department || request.discipline)}</p>
        ${request.request_note ? `<p class="hint">${esc(request.request_note)}</p>` : ""}
        <label class="signature-upload">مهر و امضای مدیر واحد<input id="request-unit-signature-${request.point_id}" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>
        <div class="actions">
          ${request.request_form_id ? `<button class="ghost" data-act="open-sheet" data-kind="in" data-id="${request.request_form_id}">مشاهده فرم IN</button>` : ""}
          <button class="ghost" data-act="open-point" data-id="${request.point_id}">جزئیات و گفتگو</button>
          <button class="primary" data-act="approve-request-unit" data-id="${request.point_id}">ثبت مهر و امضا، تأیید و ارسال آنلاین به اسنپ</button>
          <button class="warn" data-act="return-request" data-id="${request.point_id}">مرجوع به مدیر پروژه</button>
        </div>
      </div>`).join("") || `<p class="empty">درخواستی برای واحد شما ارجاع نشده است.</p>`}</div></article>`
    + `<article class="card pad"><h3>ارسال IN به اسنپ · پیگیری یافتن بازرس <span class="chip">${(data.sent_requests || []).length.toLocaleString("fa-IR")}</span></h3><p class="hint">این درخواست‌ها پس از تأیید مدیر واحد به سامانه اسنپ رسیده‌اند و برای بازرسان واجدشرایط نزدیک کارگاه ارسال یا در صف جست‌وجو هستند.</p><div class="picked-list">${(data.sent_requests || []).map((request) => `
      <div class="person">
        <span>${esc(request.tag)} · ${esc(request.title)}<small>${esc(request.buyer)} · ${esc(request.project)} · ${esc(request.dispatch_sentence || requestStatusLabel(request.request_status))}</small>
        ${request.inspector ? `<small>بازرس انتخاب‌شده: ${esc(request.inspector)}</small>` : request.offered?.length ? `<small>پیشنهادهای جاری: ${esc(request.offered.join("، "))}</small>` : ""}
        ${request.request_note ? `<small>${esc(request.request_note)}</small>` : ""}</span>
        <span class="actions">${request.request_form_id ? `<button class="ghost" data-act="open-sheet" data-kind="in" data-id="${request.request_form_id}">فرم IN</button>` : ""}<button class="ghost" data-act="open-point" data-id="${request.point_id}">پیگیری زنده</button></span>
      </div>`).join("") || `<p class="empty">درخواستی هنوز به اسنپ ارسال نشده است.</p>`}</div></article>
    </section>
    <article class="card pad"><h3>گزارش‌های بازرسی در انتظار بررسی</h3><div class="picked-list">${(data.reports || []).map((report) => `
      <button class="picked" data-act="open-ivr" data-id="${report.visit_id}">
        <b>${esc(report.ivr_no)} · ${esc(report.tag)} · ${esc(report.title)}</b>
        <small>${esc(report.inspector)} · ${esc(report.result === "accept" ? "قبول بازرس" : "رد بازرس")}</small>
        ${report.review_note ? `<em>یادداشت قبلی: ${esc(report.review_note)}</em>` : ""}
        <span class="actions"><span class="chip">بازبینی و تصمیم</span></span>
      </button>`).join("") || `<p class="empty">گزارشی برای بررسی مدیر واحد نیست.</p>`}</div></article>`
  );
  clearTimeout(state.deskTimer);
  state.deskTimer = setTimeout(() => {
    if (state.view === "desk" && state.me?.role === "unit_manager") renderUnitManagerDesk();
  }, 6000);
}

function buyerCalendarPreview(moments) {
  const start = persianMonthStart(state.calendarOffset);
  const monthParts = persianDateParts(start);
  const monthTitle = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Tehran",
  }).format(start);
  const days = [];
  const cursor = new Date(start);
  while (true) {
    const parts = persianDateParts(cursor);
    if (parts.year !== monthParts.year || parts.month !== monthParts.month) break;
    days.push({ key: persianDateKey(cursor), day: parts.day });
    cursor.setDate(cursor.getDate() + 1);
  }
  const eventDates = new Set(moments.map((moment) => String(moment.held_on || "").slice(0, 10)));
  const firstOffset = (start.getDay() + 1) % 7;
  return `<div class="buyer-calendar-heading"><h3>${esc(monthTitle)}</h3><button class="ghost" data-act="goto" data-view="calendar">مشاهدهٔ تقویم</button></div>
    <div class="buyer-calendar-grid buyer-calendar-weekdays">${["ش", "ی", "د", "س", "چ", "پ", "ج"].map((day) => `<b>${day}</b>`).join("")}</div>
    <div class="buyer-calendar-grid">${Array.from({ length: firstOffset }, () => `<span class="buyer-calendar-day blank"></span>`).join("")}
      ${days.map(({ key, day }) => `<span class="buyer-calendar-day ${key === persianDateKey(new Date()) ? "today" : ""} ${eventDates.has(key) ? "has-event" : ""}">${day.toLocaleString("fa-IR")}</span>`).join("")}
    </div>`;
}

function buyerBoardTable(rows, emptyMessage = "موردی برای نمایش وجود ندارد.") {
  const requestLabels = {
    draft: "پیش‌نویس", documents_missing: "نقص مدارک", returned: "مرجوع‌شده برای اصلاح",
    manager_review: "بررسی مدیر پروژه", unit_review: "بررسی مدیر واحد",
    executive_review: "بررسی مدیر اجرایی", inspection_queue: "در صف بازرسی",
    approved: "تأیید و ارسال به بازرس", approved_no_inspector: "تأییدشده؛ در انتظار بازرس",
  };
  const pointLabels = {
    planned: "برنامه‌ریزی‌شده", ready: "آماده", offering: "پیشنهاد به بازرس",
    assigned: "پذیرفته‌شده", en_route: "در مسیر", on_site: "در محل",
    submitted: "در انتظار تأیید گزارش", accepted: "تکمیل‌شده",
  };
  return `<div class="tablewrap"><table><thead><tr><th>پروژه</th><th>تجهیز / نقطه</th><th>وضعیت درخواست IN</th><th>وضعیت بازرسی</th><th>پیگیری</th></tr></thead><tbody>
    ${rows.map((row) => `<tr>
      <td>${esc(row.project_name)}</td><td>${esc(row.tag)} · ${esc(row.title)}</td>
      <td>${esc(requestLabels[row.request_status] || row.request_status || "—")}</td>
      <td>${esc(pointLabels[row.status] || row.status || "—")}</td>
      <td class="actions">${row.request_form_id ? `<button class="ghost" data-act="open-sheet" data-id="${row.request_form_id}" data-kind="in">مشاهده IN</button>` : ""}
        <button class="ghost" data-act="open-point" data-id="${row.id}">جزئیات</button></td>
    </tr>`).join("") || `<tr><td colspan="5">${emptyMessage}</td></tr>`}
  </tbody></table></div>`;
}

async function renderBuyerDesk() {
  const [board, moments] = await Promise.all([api("/api/board?kind=project"), api("/api/moms")]);
  const activeRequestStatuses = new Set([
    "manager_review", "unit_review", "executive_review", "inspection_queue", "approved", "approved_no_inspector",
  ]);
  const inProgressStatuses = new Set(["offering", "assigned", "en_route", "on_site"]);
  const activeIn = board.filter((row) => row.request_form_id && activeRequestStatuses.has(row.request_status)).length;
  const activeInspections = board.filter((row) => inProgressStatuses.has(row.status)).length;
  const todayTasks = board.filter((row) =>
    ["manager_review", "unit_review", "executive_review", "submitted"].includes(row.request_status)
      || row.status === "submitted"
  ).length;
  const today = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Tehran",
  }).format(new Date());
  const reminders = [...moments].sort((a, b) => String(a.held_on).localeCompare(String(b.held_on))).slice(0, 3);
  app.innerHTML = shell(
    "میز کار کارفرما",
    "نمای کلی درخواست‌ها، برنامهٔ روزانه و پیگیری بازرسی‌ها",
    `<div class="buyer-dashboard">
      <section class="buyer-welcome">
        <div><p class="eyebrow">داشبورد کارفرما</p><h2>خوش آمدید، ${esc(state.me.name)}</h2><p>${esc(today)}</p></div>
        <div class="buyer-welcome-actions">
          <button class="primary" data-act="goto" data-view="buyer-new-in">ثبت درخواست بازرسی جدید</button>
          <button class="ghost" data-act="goto" data-view="buyer-new-international">ثبت IN خارج از کشور</button>
        </div>
      </section>
      <section class="buyer-kpis">
        <button class="buyer-kpi tone-amber" data-act="goto" data-view="buyer-status"><span>وظایف و موارد نیازمند پیگیری</span><strong>${todayTasks.toLocaleString("fa-IR")}</strong><small>درخواست‌های در انتظار بررسی</small></button>
        <button class="buyer-kpi tone-blue" data-act="goto" data-view="buyer-in-list"><span>INهای فعال</span><strong>${activeIn.toLocaleString("fa-IR")}</strong><small>ثبت‌شده و در گردش کار</small></button>
        <button class="buyer-kpi tone-green" data-act="goto" data-view="buyer-progress"><span>بازرسی‌های در حال انجام</span><strong>${activeInspections.toLocaleString("fa-IR")}</strong><small>از پذیرش تا ثبت گزارش</small></button>
      </section>
      <section class="buyer-dashboard-grid">
        <article class="card pad buyer-calendar-card">${buyerCalendarPreview(moments)}</article>
        <article class="card pad buyer-reminders">
          <div class="buyer-calendar-heading"><h3>یادآورها و صورتجلسه‌ها</h3><button class="ghost" data-act="goto" data-view="moms">همهٔ صورتجلسه‌ها</button></div>
          ${reminders.map((item) => `<div class="buyer-reminder"><span>${esc(item.held_on)}</span><b>${esc(item.title)}</b><small>${esc(item.attendees || "شرکت‌کنندگان ثبت نشده‌اند")}</small></div>`).join("") || `<p class="empty">یادداشتی ثبت نشده است.</p>`}
          <div class="buyer-quick-links"><button class="ghost" data-act="goto" data-view="buyer-progress">گزارش بازرسی‌های جاری</button><button class="ghost" data-act="goto" data-view="buyer-completed">گزارش بازرسی‌های تکمیل‌شده</button></div>
        </article>
      </section>
    </div>`
  );
}

async function renderBuyerNewIn() {
  const international = state.view === "buyer-new-international";
  if (international) state.requestCustomerLocation = "international";
  const board = await api("/api/board?kind=project");
  const eligible = board.filter((row) => ["draft", "documents_missing", "returned"].includes(row.request_status));
  if (international) {
    const firstEligiblePoint = eligible[0];
    if (!firstEligiblePoint) {
      state.requestPointId = null;
      state.requestPoints = [];
      state.requestPrefill = null;
      state.inRequestMode = false;
      app.innerHTML = shell(
        "New International IN Registration",
        "No inspection points are available for an international IN request.",
        `<article class="card pad buyer-page buyer-in-entry-international" dir="ltr"><p>No inspection points are currently available for IN registration.</p></article>`
      );
      return;
    }
    state.requestPoints = eligible;
    state.pointId = Number(firstEligiblePoint.id);
    state.requestPointId = state.pointId;
    const detail = await api(`/api/points/${state.pointId}`);
    state.inRequestMode = true;
    state.formKind = "in";
    state.formId = null;
    state.formDraft = null;
    state.requestPrefill = prefillInspectionRequestForLocation(detail, "international");
    state.formReturnView = "buyer-new-international";
    state.view = "forms";
    await renderForms();
    return;
  }
  const locations = [
    ["iran", "ثبت IN داخل کشور", "⌖", "ثبت درخواست بازرسی در پروژه‌های داخل کشور"],
    ["international", "ثبت IN خارج از کشور", "◎", "ثبت درخواست بازرسی در پروژه‌های خارج از کشور"],
  ];
  app.innerHTML = shell(
    international ? "New International IN Registration" : "ثبت IN جدید",
    international ? "Select an inspection point to start your international request." : "برای شروع، موقعیت پروژه را انتخاب کنید",
    `<div class="buyer-page buyer-in-entry ${international ? "buyer-in-entry-international" : ""}"${international ? ' dir="ltr"' : ""}>
      ${international ? "" : `<section class="buyer-in-location">
        <p class="eyebrow">درخواست بازرسی جدید</p>
        <h2>موقعیت پروژه را انتخاب کنید</h2>
        <p>پس از انتخاب موقعیت، نقطهٔ بازرسی را برگزینید و فرم IN را تکمیل کنید.</p>
        <div class="buyer-location-options">${locations.map(([key, title, icon, description]) => `<button class="buyer-location-option ${state.requestCustomerLocation === key ? "selected" : ""}" data-act="choose-in-location" data-location="${key}" aria-pressed="${state.requestCustomerLocation === key}">
          <span class="buyer-location-icon" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${description}</small></span><span class="buyer-location-arrow" aria-hidden="true">←</span>
        </button>`).join("")}</div>
      </section>`}
      ${state.requestCustomerLocation ? `<article class="card pad buyer-point-list">
        <div class="buyer-page-intro"><div><h3>${international ? "Select an Inspection Point" : "انتخاب نقطهٔ بازرسی"}</h3><p>${international ? "Choose an eligible point before completing the international IN form." : `فرم IN برای ${state.requestCustomerLocation === "international" ? "پروژهٔ خارج از کشور" : "پروژهٔ داخل کشور"} تکمیل خواهد شد.`}</p></div><span class="buyer-count">${eligible.length.toLocaleString(international ? "en-US" : "fa-IR")} ${international ? "points" : "نقطه"}</span></div>
        ${eligible.map((row) => `<div class="buyer-point-row"><span><b>${esc(row.tag)} · ${esc(row.title)}</b><small>${esc(row.project_name)} · ${esc(row.discipline_label)} · ${international ? (row.request_status === "returned" ? "Returned for revision" : row.request_status === "documents_missing" ? "Missing documents" : "Ready for IN registration") : row.request_status === "returned" ? "مرجوع‌شده برای اصلاح" : row.request_status === "documents_missing" ? "نقص مدارک" : "آماده ثبت IN"}</small></span><button class="primary" data-act="open-request-form" data-id="${row.id}" data-location="${state.requestCustomerLocation}">${international ? (row.request_status === "returned" ? "Revise IN Form" : "Complete IN Form") : row.request_status === "returned" ? "اصلاح فرم IN" : "تکمیل فرم IN"}</button></div>`).join("") || `<p class="empty">${international ? "No inspection points are currently available for IN registration." : "نقطه‌ای برای ثبت درخواست IN موجود نیست."}</p>`}
      </article>` : ""}
    </div>`
  );
}

async function renderBuyerInList() {
  const board = await api("/api/board?kind=project");
  const rows = board.filter((row) => row.request_status !== "draft");
  app.innerHTML = shell(
    "INهای ثبت‌شده",
    "فهرست درخواست‌های ارسال‌شده و وضعیت گردش کار آن‌ها",
    `<article class="card pad buyer-page">${buyerBoardTable(rows, "هنوز درخواست IN ثبت نشده است.")}</article>`
  );
}

async function renderBuyerItpList() {
  const board = await api("/api/board?kind=project");
  app.innerHTML = shell(
    "ITPهای ثبت‌شده",
    "برنامهٔ نقاط بازرسی پروژه‌ها و وضعیت هر نقطه",
    `<div class="buyer-page"><article class="card pad buyer-page-intro"><div><h2>نقاط برنامهٔ بازرسی</h2><p>این فهرست، نقاط برنامه‌ریزی‌شدهٔ ITP را از گردش کار پروژه نمایش می‌دهد.</p></div><button class="ghost" data-act="goto" data-view="buyer-itp-new">ثبت ITP جدید</button></article><article class="card pad">${buyerBoardTable(board)}</article></div>`
  );
}

function renderBuyerItpNew() {
  app.innerHTML = shell(
    "ثبت ITP جدید",
    "راهنمای ثبت و گردش برنامهٔ بازرسی و آزمون",
    `<article class="card pad buyer-itp-notice"><span class="chip wait">ثبت ITP در نقش کارفرما غیرفعال است</span><h2>ثبت ITP توسط سازنده انجام می‌شود</h2><p>فرم ثبت ITP در نسخهٔ فعلی برای نقش مدیر اجرایی تعریف شده است. این صفحه دسترسی ثبت را تغییر نمی‌دهد؛ می‌توانید نقاط برنامهٔ ITP و وضعیت آن‌ها را مشاهده کنید.</p><button class="primary" data-act="goto" data-view="buyer-itp-list">مشاهدهٔ نقاط ITP ثبت‌شده</button></article>`
  );
}

async function renderBuyerProgress() {
  const board = await api("/api/board?kind=project");
  const rows = board.filter((row) =>
    ["offering", "assigned", "en_route", "on_site", "submitted"].includes(row.status)
      || ["manager_review", "unit_review", "executive_review", "inspection_queue", "approved", "approved_no_inspector"].includes(row.request_status)
  );
  const progressRows = await Promise.all(rows.map(async (row) => {
    const [detail, form] = await Promise.all([
      api(`/api/points/${row.id}`),
      row.request_form_id ? api(`/api/forms/${row.request_form_id}`) : Promise.resolve(null),
    ]);
    const location = [
      detail.equipment.workshop_name,
      detail.equipment.city,
    ].filter(Boolean).join("، ");
    const payload = form?.payload || {};
    const searchable = [
      payload.number,
      detail.order.number,
      detail.project.name,
      detail.companies.vendor,
      location,
      row.tag,
      row.title,
    ].filter(Boolean).join(" ").toLocaleLowerCase("fa-IR");
    const inspectionActive = ["offering", "assigned", "en_route", "on_site"].includes(row.status);
    const status = inspectionActive
      ? ["در حال انجام", "In Progress"]
      : row.status === "submitted"
        ? ["در انتظار بررسی گزارش", "Report Review"]
        : row.request_status === "manager_review"
          ? ["بررسی مدیر پروژه", "Project Manager Review"]
          : row.request_status === "unit_review"
            ? ["بررسی مدیر واحد", "Unit Manager Review"]
            : ["در جریان تأیید درخواست", "Request Review"];
    return { row, detail, form, location, searchable, status };
  }));
  app.innerHTML = shell(
    "بازرسی‌های در حال انجام",
    "درخواست‌های در گردش و نقاطی که هنوز به نتیجهٔ نهایی نرسیده‌اند",
    `<article class="card pad buyer-page buyer-progress-page">
      <label class="buyer-progress-search"><span aria-hidden="true">⌕</span><input type="search" data-buyer-progress-search placeholder="جست‌وجو در بازرسی‌های در حال انجام (Search in inspections in progress...)" aria-label="جست‌وجو در بازرسی‌های در حال انجام"></label>
      <div class="tablewrap buyer-progress-table-wrap"><table class="buyer-progress-table">
        <thead><tr>
          <th>مشاهده گزارش<br><small>(View Report)</small></th>
          <th>محل بازرسی<br><small>(Inspection Location)</small></th>
          <th>پیمانکار<br><small>(Contractor)</small></th>
          <th>نام پروژه<br><small>(Project Name)</small></th>
          <th>شماره PO<br><small>(PO Number)</small></th>
          <th>شماره IN<br><small>(IN Number)</small></th>
        </tr></thead>
        <tbody>${progressRows.map(({ row, detail, form, location, searchable, status }) => `<tr data-buyer-progress-row data-search="${esc(searchable)}">
          <td><span class="buyer-progress-status">${esc(status[0])}<small>(${esc(status[1])})</small></span><button class="buyer-progress-view" type="button" data-act="open-point" data-id="${row.id}" aria-label="مشاهده گزارش ${esc(row.tag)}" title="مشاهده گزارش">◉</button></td>
          <td>${esc(location || "—")}</td>
          <td>${esc(detail.companies.vendor || form?.payload?.contractor || "—")}</td>
          <td>${esc(detail.project.name || row.project_name)}<small>${esc(row.tag)} · ${esc(row.title)}</small></td>
          <td>${esc(detail.order.number || form?.payload?.po || "—")}</td>
          <td>${esc(form?.payload?.number || "—")}</td>
        </tr>`).join("") || `<tr class="buyer-progress-empty"><td colspan="6">بازرسی در حال انجامی وجود ندارد.</td></tr>`}</tbody>
      </table></div>
    </article>`
  );
}

async function renderBuyerCompleted() {
  const rows = await api("/api/company/inspections");
  app.innerHTML = shell(
    "بازرسی‌های انجام‌شده",
    "گزارش بازرسی پروژه‌های کارفرما و وضعیت تأیید نهایی",
    `<article class="card pad buyer-page"><div class="tablewrap"><table><thead><tr><th>گزارش</th><th>پروژه</th><th>تجهیز / نقطه</th><th>بازرس</th><th>نتیجه</th><th>تأیید کارفرما</th><th>تاریخ ثبت</th><th></th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${esc(row.ivr_no)}</td><td>${esc(row.project)}</td><td>${esc(row.tag)} · ${esc(row.title)}</td><td>${esc(row.inspector)}</td><td>${esc(row.result_label)}${row.client_rejection_note ? `<small>${esc(row.client_rejection_note)}</small>` : ""}</td><td>${row.client_approved ? "تأییدشده" : row.client_rejection_note ? "ردشده" : "در انتظار"}</td><td>${esc(faWhen(row.submitted_at).date)}</td><td><button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">مشاهده</button></td></tr>`).join("") || `<tr><td colspan="8">بازرسی انجام‌شده‌ای برای شرکت ثبت نشده است.</td></tr>`}
    </tbody></table></div></article>`
  );
}

async function renderBuyerStatus() {
  const board = await api("/api/board?kind=project");
  const statuses = [
    ["manager_review", "در انتظار بررسی مدیر پروژه"], ["unit_review", "در انتظار بررسی مدیر واحد"],
    ["executive_review", "در انتظار بررسی مدیر اجرایی"], ["inspection_queue", "در صف بازرسی"],
    ["approved", "تأیید و ارسال به بازرس"], ["approved_no_inspector", "تأییدشده؛ در انتظار بازرس"],
    ["offering", "پیشنهاد به بازرس"], ["assigned", "بازرس پذیرفته"], ["en_route", "بازرس در مسیر"],
    ["on_site", "بازرس در محل"], ["submitted", "گزارش در انتظار بررسی"], ["accepted", "بازرسی تکمیل‌شده"],
  ];
  app.innerHTML = shell(
    "صورت‌وضعیت بازرسی",
    "خلاصهٔ نقاط پروژه بر اساس وضعیت جاری",
    `<div class="buyer-page buyer-status-grid">${statuses.map(([key, label]) => {
      const count = board.filter((row) => row.request_status === key || row.status === key).length;
      return `<article class="card pad buyer-status-card"><span>${label}</span><strong>${count.toLocaleString("fa-IR")}</strong></article>`;
    }).join("")}</div>`
  );
}

function renderBuyerDate() {
  const today = new Date().toISOString().slice(0, 10);
  app.innerHTML = shell(
    "تبدیل تاریخ",
    "مشاهدهٔ معادل شمسی و میلادی",
    `<article class="card pad buyer-date-card"><h2>مبدل تاریخ</h2><label>تاریخ میلادی<input id="buyer-date-input" type="date" value="${today}"></label><button class="primary" data-act="convert-date">تبدیل تاریخ</button><p class="buyer-date-result" id="buyer-date-result">تاریخ شمسی: ${new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long", timeZone: "Asia/Tehran" }).format(new Date())}</p></article>`
  );
}

async function renderBuyerBills() {
  const bills = await api("/api/bills");
  app.innerHTML = shell(
    "صورت‌وضعیت و فاکتور",
    "اسناد مالی مربوط به بازرسی‌های تأییدشده",
    `<div class="buyer-page">${billBoard(bills)}</div>`
  );
}

async function renderDesk() {
  if (["manager", "executive_manager"].includes(state.me.role)) {
    await renderManagerDesk();
    return;
  }
  if (state.me.role === "unit_manager") {
    await renderUnitManagerDesk();
    return;
  }
  if (state.me.role === "buyer") {
    await renderBuyerDesk();
    return;
  }
  const kind = state.kind === "case" ? "case" : "project";
  const manager = ["manager", "coordinator", "admin"].includes(state.me.role);
  const client = state.me.role === "buyer" || state.me.role === "admin";
  const requests = [
    api(`/api/dashboard?kind=${kind}`),
    api(`/api/board?kind=${kind}`),
    manager ? api("/api/reports/inbox") : Promise.resolve([]),
    client ? api("/api/reports/client") : Promise.resolve([]),
    client ? api("/api/bills") : Promise.resolve([]),
  ];
  const [dash, board, reports, released, bills] = await Promise.all(requests);
  const total = dash.points_total || 0;
  const accepted = dash.by_status.accepted || 0;
  const percent = total ? Math.round((accepted / total) * 100) : 0;
  const liveCount = ["offering", "assigned", "en_route", "on_site"].reduce((sum, key) => sum + (dash.by_status[key] || 0), 0);
  const rate = dash.acceptance_rate == null ? "—" : `${Math.round(dash.acceptance_rate * 100).toLocaleString("fa-IR")}٪`;
  const groups = {
    ready: board.filter((row) => (row.status === "ready" || row.status === "planned") && !row.ncr_open),
    live: board.filter((row) => ["offering", "assigned", "en_route", "on_site"].includes(row.status)),
    review: board.filter((row) => row.status === "submitted" || row.ncr_open),
    done: board.filter((row) => row.status === "accepted"),
  };
  const flow = [
    ["planned", "برنامه", "#8ea397"],
    ["ready", "آماده", "#1d4e73"],
    ["offering", "پیشنهاد", "#0f6b43"],
    ["assigned", "پذیرفته", "#14915a"],
    ["en_route", "در مسیر", "#3aa56e"],
    ["on_site", "در محل", "#67b48a"],
    ["submitted", "منتظر تأیید", "#c4842a"],
    ["accepted", "تأیید شده", "#0c3d28"],
  ].filter(([key]) => dash.by_status[key]);
  const equipment = [];
  const seen = new Map();
  board.forEach((row) => {
    if (!seen.has(row.tag)) {
      const bucket = { tag: row.tag, title: row.equipment, items: [] };
      seen.set(row.tag, bucket);
      equipment.push(bucket);
    }
    seen.get(row.tag).items.push(row);
  });
  const showMoney = ["coordinator", "buyer", "manager", "admin"].includes(state.me.role);
  const showOperationalDashboard = true;
  const caseMode = kind === "case";
  const pieces = new Set(board.map((row) => row.tag)).size;
  app.innerHTML = shell(
    caseMode ? "بازرسی موردی" : "بازرسی پروژه‌ها",
    caseMode ? "یک درخواست جدا، بدون برنامه چندنقطه‌ای" : "طرح فلامینگو · برنامه ITP تجهیزات ثابت",
    `<div class="desk">
      ${manager ? managerTray(reports) : ""}
      ${client ? clientTray(released) : ""}
      ${client ? billBoard(bills) : ""}
      ${showOperationalDashboard ? `
      <section class="hero-card">
        ${ring(percent)}
        <div>
          <p class="eyebrow">سلام ${esc(state.me.name)}</p>
          <h2>${accepted.toLocaleString("fa-IR")} نقطه از ${total.toLocaleString("fa-IR")} تأیید شده است</h2>
          <p>${caseMode ? "این درخواست داخل طرح فلامینگو نیست. مدارک همان قلم باید آماده باشد و بازرس مثل بقیه درخواست‌ها آن را می‌پذیرد." : "اعزام فقط بعد از کامل شدن مدارک انجام می‌شود. پذیرش بازرس ۳۰ دقیقه مهلت دارد."}</p>
        </div>
        <div class="hero-side">
          <span><b>${liveCount.toLocaleString("fa-IR")}</b> اعزام زنده</span>
          <span><b>${dash.open_ncr.toLocaleString("fa-IR")}</b> عدم انطباق باز</span>
          <span><b>${dash.offers_pending.toLocaleString("fa-IR")}</b> پیشنهاد نزد بازرس</span>
        </div>
      </section>
      <section class="kpis">
        <article class="kpi tone-ink"><span>همه نقاط</span><strong>${total.toLocaleString("fa-IR")}</strong><small>روی ${pieces.toLocaleString("fa-IR")} قلم</small></article>
        <article class="kpi tone-green"><span>نرخ پذیرش پیشنهاد</span><strong>${rate}</strong><small>قبول نسبت به رد و انقضا</small></article>
        <article class="kpi tone-amber"><span>در انتظار بررسی هماهنگ‌کننده</span><strong>${(dash.by_status.submitted || 0).toLocaleString("fa-IR")}</strong><small>منتظر تأیید یا برگرداندن</small></article>
        <article class="kpi tone-red"><span>صفحه باز عدم انطباق</span><strong>${dash.open_ncr.toLocaleString("fa-IR")}</strong><small>باید دوباره اعزام شود</small></article>
        ${showMoney ? `<article class="kpi tone-blue"><span>تسویه تأییدشده</span><strong>${money(dash.fees_irr)}</strong><small>سهم سامانه ${money(dash.commission_irr)}</small></article>` : ""}
      </section>
      <section class="card pad flow">
        <div class="split"><h3>جریان نقاط</h3><small>${total.toLocaleString("fa-IR")} نقطه</small></div>
        <div class="bar">${flow.map(([key, label, color]) => `<i style="width:${(dash.by_status[key] / total) * 100}%;background:${color}" title="${label}"></i>`).join("")}</div>
        <div class="legend">${flow.map(([key, label, color]) => `<span><i style="background:${color}"></i>${label} ${dash.by_status[key].toLocaleString("fa-IR")}</span>`).join("")}</div>
      </section>
      <section class="equips">
        ${equipment.map((item) => {
          const done = item.items.filter((row) => row.status === "accepted").length;
          const width = Math.round((done / item.items.length) * 100);
          const next = item.items.find((row) => row.status !== "accepted") || item.items[0];
          return `<button class="equip" data-act="open-point" data-id="${next.id}">
            <b>${esc(item.tag)}</b>
            <small>${esc(item.title)}</small>
            <span class="meter"><i style="width:${width}%"></i></span>
            <em>${done.toLocaleString("fa-IR")} از ${item.items.length.toLocaleString("fa-IR")}</em>
          </button>`;
        }).join("")}
      </section>
      ${!["buyer", "vendor"].includes(state.me.role) ? `<section class="card pad">
        <h3>بازرس انتخاب‌شده برای اعزام</h3>
        ${managerDispatchList([...groups.live, ...groups.review].map((row) => ({
          point_id: row.id,
          project: row.project_name,
          project_code: row.project_code,
          tag: row.tag,
          title: row.title,
          status: row.status,
          inspector: row.assignee,
          dispatch_sentence: row.dispatch_sentence,
          offered: row.offered,
        })))}
      </section>` : ""}
      <section class="columns">
        ${column("صف آمادگی", "ready", groups.ready, 6)}
        ${column("اعزام زنده", "live", groups.live, 6)}
        ${column("بازبینی و عدم انطباق", "review", groups.review, 6)}
        ${column("بسته شده", "done", groups.done, 5)}
      </section>
      ` : ""}
    </div>`
  );
  clearTimeout(state.deskTimer);
  if (manager || client) {
    state.deskTimer = setTimeout(() => {
      if (state.view === "desk") render();
    }, 6000);
  }
}

function rideMap(map, focusId) {
  const roads = `
    <rect width="760" height="640" fill="#e7edf2"></rect>
    <path d="M0 180 H760 M0 340 H760 M0 500 H760 M140 0 V640 M340 0 V640 M540 0 V640" stroke="#f7f9fb" stroke-width="18"></path>
    <path d="M40 80 C180 140 260 40 420 120 S680 200 740 90" fill="none" stroke="#d5dee6" stroke-width="10"></path>
    <path d="M20 420 C200 360 300 480 520 400 S700 460 760 390" fill="none" stroke="#d5dee6" stroke-width="10"></path>`;
  const pins = map.inspectors.flatMap((person) => {
    const pin = projectPin(person.lat, person.lng);
    if (!pin) return [];
    const y = pin.y + 40;
    const mine = person.id === focusId;
    const fill = person.engagement === "hourly" ? "#f4b000" : "#00a854";
    return [`
      ${mine ? `<circle cx="${pin.x}" cy="${y}" r="18" fill="none" stroke="${fill}" stroke-width="3"><animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.3;1" dur="1.6s" repeatCount="indefinite"/></circle>` : ""}
      <circle cx="${pin.x}" cy="${y}" r="${mine ? 9 : 7}" fill="${person.online ? fill : "#9aa6b2"}"></circle>
      <text x="${pin.x + 12}" y="${y + 4}" font-size="12" fill="#1d2b36">${esc(person.name.split(" ")[0])} · ${esc(person.engagement_label || "")}</text>`];
  });
  const shop = map.workshops[0];
  const shopPin = projectPin(shop.lat, shop.lng);
  const dest = `
    <path d="M${shopPin.x} ${shopPin.y + 18} c0 16 14 28 0 44 c-14-16 0-28 0-44z" fill="#111"></path>
    <circle cx="${shopPin.x}" cy="${shopPin.y + 30}" r="5" fill="white"></circle>
    <text x="${shopPin.x + 14}" y="${shopPin.y + 34}" font-size="13" font-weight="700" fill="#111">مقصد کارگاه</text>`;
  return `<svg viewBox="0 0 760 640" aria-label="نقشه اعزام">${roads}${pins.join("")}${dest}</svg>`;
}

function requestSheet(offer) {
  const remain = Math.max(0, Math.round((new Date(offer.offer.expires_at.replace(" ", "T")).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  return `
    <div class="handle"></div>
    <p class="eyebrow">درخواست بازرسی · ${esc(offer.offer.engagement_label || "بازرس")}</p>
    <h2>${esc(offer.equipment.tag)} · ${esc(offer.point.title)}</h2>
    <p>${esc(offer.equipment.workshop_name)} · ${Number(offer.offer.distance_km).toLocaleString("fa-IR")} کیلومتر</p>
    <div class="fare">
      <b>${money(offer.offer.total_inspector_irr || offer.offer.net_irr)}</b>
      ${offer.offer.travel_irr ? `<small>دستمزد پایه ${money(offer.offer.net_irr)} + ایاب‌وذهاب یک‌طرفه ${money(offer.offer.travel_irr)}</small>` : ""}
      <span>مهلت ${minutes.toLocaleString("fa-IR")}:${String(seconds).padStart(2, "0").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit])}</span>
    </div>
    ${historyBlock(offer.history)}
    <button class="go" data-act="accept" data-id="${offer.offer.id}">قبول می‌کنم</button>
    <button class="nope" data-act="decline" data-id="${offer.offer.id}">رد، برو سراغ نفر بعدی</button>`;
}

function projectPin(lat, lng) {
  const minLat = 35.68;
  const maxLat = 35.84;
  const minLng = 50.9;
  const maxLng = 51.32;
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return null;
  return {
    x: ((lng - minLng) / (maxLng - minLng)) * 700 + 30,
    y: ((maxLat - lat) / (maxLat - minLat)) * 400 + 36,
  };
}

async function renderDispatch() {
  const [map, inbox, active, board] = await Promise.all([
    api("/api/map"),
    api("/api/offers/inbox"),
    api("/api/visits/active"),
    api("/api/board"),
  ]);
  const offer = inbox[0];
  const focusId = offer ? offer.offer.inspector_id : (active ? active.visit.inspector_id : null);
  let sheet = `
    <div class="handle"></div>
    <p class="eyebrow">در حال پیدا کردن بازرس</p>
    <h2>نزدیک‌ترین بازرس واجد شرایط</h2>
    <p>درخواست به‌ترتیب فاصله ارسال می‌شود. هر بازرس ۳۰ دقیقه برای پذیرش فرصت دارد؛ سپس پیشنهاد به نفر بعدی می‌رسد.</p>`;
  if (state.me.role === "inspector" && offer && !active) sheet = requestSheet(offer);
  else if (state.me.role === "inspector" && active) sheet = `<div class="handle"></div>${visitPhone(active)}`;
  else if (state.me.role !== "inspector") sheet = `<div class="handle"></div>${dispatchChoices(board)}`;
  app.innerHTML = shell(
    "اعزام",
    "",
    `<div class="ride">${rideMap(map, focusId)}<aside class="sheet">${sheet}</aside></div>`
  );
  clearTimeout(state.deskTimer);
  state.deskTimer = setTimeout(() => {
    if (state.view === "dispatch") render();
  }, 5000);
}

function dispatchChoices(board) {
  const rows = board.filter((row) => ["offering", "assigned", "en_route", "on_site", "submitted"].includes(row.status) || row.ncr_open);
  return `
    <h3>انتخاب سامانه</h3>
    <p class="hint">هر بار فقط یک بازرس: نزدیک‌ترین فرد واجد شرایط ۳۰ دقیقه فرصت پذیرش دارد؛ سپس پیشنهاد به نفر بعدی بر اساس فاصله می‌رسد.</p>
    <div class="stack">
      ${rows.map((row) => `
        <button class="picked" data-act="open-point" data-id="${row.id}">
          <b>${esc(row.assignee || "در انتظار تأیید")}</b>
          <small>${esc(row.kind_label || "")} · ${esc(row.tag)} · ${esc(row.title)} · ${esc(STATUS[row.status] || row.status)}</small>
          <em>${esc(row.dispatch_sentence)}</em>
        </button>`).join("") || `<p class="empty">اعزامی در جریان نیست.</p>`}
    </div>`;
}

const SHOTS = [
  ["item", "مورد بازرسی", "خود قطعه یا محل آزمون"],
  ["environment", "محیط", "فضای کارگاه اطراف کار"],
  ["marker", "پیکان‌کار", "نشانگر روی نقطهٔ مورد بازرسی"],
];

function shotBoard(active) {
  const photos = active.photos || [];
  return `<p class="hint">این عکس‌ها با دوربین گوشی در پرونده بازدید ثبت می‌شوند.</p><div class="shots">${SHOTS.map(([kind, label, hint]) => {
    const shot = photos.find((row) => row.kind === kind && row.url);
    const saved = photos.some((row) => row.kind === kind);
    return `<label class="shot">
      <b>${label}</b>
      <small>${hint}</small>
      ${shot ? `<img src="${esc(shot.url)}" alt="${esc(label)}">` : ""}
      <input type="file" accept="image/*" capture="environment" data-act="pick-photo" data-kind="${kind}" data-id="${active.visit.id}" ${active.visit.location_confirmed ? "" : "disabled"}>
      <em>${saved ? "ثبت شد" : "گرفتن با دوربین موبایل"}</em>
    </label>`;
  }).join("")}</div>`;
}

function visitPhone(active) {
  const phase = active.visit.phase;
  const equipment = active.context.equipment;
  const inFormId = active.context.point.request_form_id;
  const signatureUploaded = Boolean(active.visit.signature_uploaded);
  const checks = active.context.point.checklist.map((item) => {
    const current = state.draft[item.id] || "pass";
    return `<div class="check"><b>${esc(item.text)}</b><div class="rowline">
      ${["pass", "fail", "na"].map((value) => `<label><input type="radio" name="c-${item.id}" data-act="answer" data-item="${esc(item.id)}" value="${value}" ${current === value ? "checked" : ""}> ${value === "pass" ? "قبول" : value === "fail" ? "رد" : "موضوعیت ندارد"}</label>`).join("")}
    </div></div>`;
  }).join("");
  const locationConfirmed = Boolean(active.visit.location_confirmed);
  return `
    <h2>${esc(equipment.tag)}</h2>
    <p>${esc(active.context.point.title)}</p>
    <p>مرحله: ${esc(STATUS[phase] || phase)}</p>
    ${inFormId ? `<article class="card pad"><b>فرم خام IN کارفرما</b><p class="hint">فرم اصلی فقط‌خواندنی می‌ماند. نسخهٔ مخصوص این بازدید را تکمیل و ذخیره کنید؛ این دو فرم جداگانه نگهداری می‌شوند.</p><div class="actions"><button class="ghost" data-act="open-sheet" data-id="${inFormId}" data-kind="in">مشاهده فرم IN اصلی</button><button class="primary" data-act="open-visit-report-form" data-id="${active.visit.id}">${active.visit.report_form_completed ? "مشاهده / ویرایش فرم تکمیل‌شدهٔ گزارش" : "تکمیل فرم IN گزارش بازرسی"}</button></div>${active.visit.report_form_completed ? `<p class="chip ok">نسخهٔ گزارش ذخیره شده است.</p>` : `<p class="chip wait">ذخیرهٔ مدت و شرح بازرسی پیش از ارسال گزارش الزامی است.</p>`}</article>` : ""}
    ${historyBlock(active.context.history, active.visit.id)}
    <div class="actions">
      ${phase === "assigned" && !active.visit.remote ? `<button class="primary" data-act="enroute" data-id="${active.visit.id}">به سمت کارگاه</button>` : ""}
      ${phase === "assigned" && active.visit.remote ? `<button class="primary" data-act="remote" data-id="${active.visit.id}">شروع بازبینی مدارک</button>` : ""}
      ${phase === "en_route" ? `<button class="primary" data-act="arrive" data-id="${active.visit.id}">فعال‌سازی موقعیت و تأیید حضور در کارگاه</button>` : ""}
    </div>
    ${phase === "on_site" && active.visit.remote && !locationConfirmed ? `<p class="hint">برای فعال شدن چک‌لیست و پیوست گزارش، موقعیت جغرافیایی دستگاه را فعال و تأیید کنید.</p><button class="primary" data-act="confirm-location" data-id="${active.visit.id}">فعال‌سازی و تأیید موقعیت جغرافیایی</button>` : ""}
    ${phase === "on_site" && locationConfirmed ? `<div class="stack">${checks}${shotBoard(active)}
      <label class="signature-upload">مهر و امضای بازرس · برای ارسال گزارش الزامی است<input id="inspector-report-signature" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" ${signatureUploaded ? "" : "required"}></label>
      <p class="hint">${signatureUploaded ? "مهر و امضای گزارش ثبت شده است." : "پس از تکمیل چک‌لیست و پیوست‌ها، مهر و امضای تصویری خود را بارگذاری کنید."}</p>
      <div class="actions"><button class="primary" data-act="submit-visit" data-id="${active.visit.id}" data-result="accept" ${inFormId && !active.visit.report_form_completed ? "disabled" : ""}>امضا و ارسال گزارش قبول</button><button class="danger" data-act="submit-visit" data-id="${active.visit.id}" data-result="reject" ${inFormId && !active.visit.report_form_completed ? "disabled" : ""}>امضا و ارسال گزارش رد</button></div>
    </div>` : ""}`;
}

async function renderPoint() {
  const detail = await api(`/api/points/${state.pointId}`);
  const point = detail.point;
  const latest = detail.visits[detail.visits.length - 1];
  const unitManagers = state.me.role === "manager" && point.request_status === "manager_review"
    ? await api("/api/unit-managers")
    : [];
  const canReturn = (
    state.me.role === "manager" && point.request_status === "manager_review"
    || state.me.role === "unit_manager" && point.request_status === "unit_review"
    || state.me.role === "executive_manager" && point.request_status === "executive_review"
    || ["coordinator", "admin"].includes(state.me.role) && ["inspection_queue", "approved_no_inspector"].includes(point.request_status)
  );
  app.innerHTML = shell(
    `${detail.equipment.tag} — ${point.title}`,
    `${detail.project.name} · ${detail.companies.vendor}`,
    `<div class="grid2">
      <article class="card pad detail">
        <p class="chip ${detail.project.kind === "case" ? "wait" : "ok"}">${esc(detail.project.kind_label)} · ${esc(detail.project.code)}</p>
        ${detail.selection && detail.selection.sentence ? `<p class="dispatch-banner">${esc(detail.selection.sentence)}</p>` : ""}
        <div class="split">
          <span class="chip">${esc(STATUS[point.status] || point.status)}</span>
          <span class="chip ${point.point_type === "H" ? "hold" : ""}">${esc(point.point_type_label)}</span>
          <span class="chip">${esc(point.discipline_label)}</span>
          ${point.ncr_open ? `<span class="chip bad">NCR</span>` : ""}
        </div>
        <p>استاندارد: ${esc(point.standard_ref)}</p>
        <p>کارگاه: ${esc(detail.equipment.workshop_name)}، ${esc(detail.equipment.city)}</p>
        <p class="request-state">وضعیت درخواست: ${esc({
          draft: "ثبت نشده",
          documents_missing: "مدرک ناقص",
          manager_review: "در انتظار مدیر پروژه",
          executive_review: "در انتظار مدیر اجرایی",
          unit_review: "در انتظار مدیر واحد",
          inspection_queue: "در کارتابل بازرسی",
          approved: "تأیید و ارسال به بازرس",
          approved_no_inspector: "تأیید شده؛ در انتظار بازرس آنلاین",
          returned: "برگشت‌خورده برای اصلاح",
        }[point.request_status] || point.request_status)}</p>
        ${point.request_note ? `<p class="hint">${esc(point.request_note)}</p>` : ""}
        ${point.request_form_id && ["buyer", "manager", "executive_manager"].includes(state.me.role) ? `<button class="ghost" data-act="open-sheet" data-id="${point.request_form_id}" data-kind="in">مشاهده فرم IN کارفرما</button>` : ""}
        ${point.request_approvals?.length ? `<section class="request-approvals"><h3>مهر و امضاهای مراحل تأیید</h3><div class="approval-signatures">${point.request_approvals.map((approval) => `
          <article class="approval-signature">
            <p><b>${approval.stage === "manager" ? "مدیر پروژه" : "مدیر واحد"}</b> · ${esc(approval.actor)}</p>
            <small>${esc(approval.created_at)} · ${esc(approval.filename)}</small>
            <a href="${esc(approval.url)}" target="_blank" rel="noopener"><img src="${esc(approval.url)}" alt="مهر و امضای ${approval.stage === "manager" ? "مدیر پروژه" : "مدیر واحد"}"></a>
          </article>`).join("")}</div></section>` : ""}
        ${state.me.role === "manager" && point.request_status === "manager_review" ? `<div class="archive-upload">
          <label>واحد تخصصی<select id="request-department">${Object.entries(DISC).map(([key, label]) => `<option value="${esc(label)}" ${key === point.discipline ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
          <label>مدیر واحد<select id="request-unit-manager">${unitManagers.map((manager) => `<option value="${manager.id}">${esc(manager.name)}</option>`).join("")}</select></label>
          <label>یادداشت مدیر پروژه<input id="request-manager-note" value=""></label>
          <label class="signature-upload">مهر و امضای مدیر پروژه<input id="request-manager-signature" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>
        </div>` : ""}
        ${state.me.role === "unit_manager" && point.request_status === "unit_review" ? `<label class="signature-upload">مهر و امضای مدیر واحد<input id="request-unit-signature-${point.id}" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>` : ""}
        <h3>چک‌لیست</h3>
        <ul>${point.checklist.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>
        <h3>مدارک لازم</h3>
        <p>${point.required_docs.map((doc) => esc(doc.label)).join("، ")}</p>
        ${point.missing_docs.length ? `<p class="chip wait">ناقص: ${point.missing_docs.map((doc) => esc(doc.label)).join("، ")}</p>` : `<p class="chip ok">مدارک این نقطه آماده‌اند</p>`}
        <div class="actions">
          ${state.me.role === "buyer" && ["draft", "documents_missing", "returned"].includes(point.request_status) ? `<button class="primary" data-act="open-request-form" data-id="${point.id}">ثبت فرم IN و ارسال درخواست</button>` : ""}
          ${state.me.role === "manager" && point.request_status === "manager_review" ? `<button class="primary" data-act="approve-request-manager" data-id="${point.id}">ثبت مهر و امضا، تأیید و ارجاع به مدیر واحد</button>` : ""}
          ${state.me.role === "unit_manager" && point.request_status === "unit_review" ? `<button class="primary" data-act="approve-request-unit" data-id="${point.id}">ثبت مهر و امضا و ارسال به اسنپ</button>` : ""}
          ${state.me.role === "executive_manager" && point.request_status === "executive_review" ? `<button class="primary" data-act="approve-request-executive" data-id="${point.id}">تأیید و ارسال پیشنهاد به نزدیک‌ترین بازرس</button>` : ""}
          ${state.me.role === "vendor" && ["planned", "ready"].includes(point.status) ? `<button class="primary" data-act="ready" data-id="${point.id}" data-remote="${point.remote_allowed ? "1" : "0"}">اعلام آمادگی</button>` : ""}
          ${["coordinator", "admin"].includes(state.me.role) && point.status === "ready" && point.request_status === "approved_no_inspector" ? `<button class="primary" data-act="broadcast" data-id="${point.id}">ارسال به بازرسان نزدیک</button>` : ""}
          ${latest ? `<button class="ghost" data-act="open-ivr" data-id="${latest.id}">گزارش IVR</button>` : ""}
        </div>
        ${canReturn ? `<div class="archive-upload">
          <label>دلیل مرجوعی<input id="request-return-reason" minlength="3" maxlength="2000" placeholder="دلیل مرجوعی را وارد کنید"></label>
          <button class="warn" data-act="return-request" data-id="${point.id}">مرجوع به مرحله قبل</button>
        </div>` : ""}
        <h3>گفتگو و یادداشت‌های درخواست</h3>
        <div class="picked-list">${(point.request_comments || []).map((comment) => `<div class="person"><span>${esc(comment.author)}: ${esc(comment.body)}</span><small>${esc(faWhen(comment.created_at).date)} ${esc(faWhen(comment.created_at).time)}</small></div>`).join("") || `<p class="empty">نظری ثبت نشده است.</p>`}</div>
        ${["admin", "coordinator", "executive_manager", "unit_manager", "manager", "buyer", "vendor"].includes(state.me.role) ? `<div class="archive-upload"><label>ثبت نظر<input id="request-comment-body" maxlength="4000" placeholder="یادداشت یا پاسخ"></label><button class="ghost" data-act="send-request-comment" data-id="${point.id}">ارسال نظر</button></div>` : ""}
      </article>
      <article class="card pad">
        <h3>پیشنهادها</h3>
        ${detail.offers.slice(0, 8).map((offer) => `<div class="person ${offer.status === "accepted" ? "chosen" : ""}"><span>${esc(offer.inspector)}${offer.status === "accepted" ? " · انتخاب شد" : ""}</span><small>${esc(OFFER_STATUS[offer.status] || offer.status)} · ${money(offer.total_inspector_irr || offer.net_irr)}${offer.travel_irr ? ` · ایاب‌وذهاب ${money(offer.travel_irr)}` : ""}</small></div>`).join("") || "<p>هنوز پیشنهادی نرفته است.</p>"}
        <h3>مراحل قبلی و ایرادها</h3>
        ${historyBlock(detail.history)}
        <h3>بازدیدها</h3>
        ${detail.visits.map((visit) => `<div class="person"><span>${esc(visit.inspector)}</span><small>${esc(visit.ivr_no || STATUS[visit.phase] || visit.phase)} · ${esc(visit.result === "accept" ? "قبول" : visit.result === "reject" ? "رد" : "جاری")}</small></div>`).join("") || "<p>بازدیدی ثبت نشده.</p>"}
      </article>
    </div>`
  );
}

async function renderIvr(visitId) {
  const report = await api(`/api/visits/${visitId}/ivr`);
  const canAttach = state.me.role === "inspector" && report.visit.location_confirmed && report.visit.phase === "on_site";
  const comments = report.comments || [];
  const stage = report.visit.report_stage;
  const reviewRole = state.me.role === "unit_manager" && stage === "unit_review"
    || state.me.role === "manager" && stage === "manager_review";
  const clientReview = state.me.role === "buyer" && stage === "client_review" && report.visit.phase === "client";
  const reviewControls = reviewRole ? `
    <label>یادداشت بررسی / دلیل مرجوعی<textarea id="review-note-${report.visit.id}" rows="3" maxlength="2000" placeholder="برای مرجوعی، دلیل را بنویسید"></textarea></label>
    <div class="actions">
      ${report.visit.result === "accept" ? `<button class="primary" data-act="review" data-id="${report.visit.id}" data-decision="approve">${stage === "unit_review" ? "تأیید و ارسال به مدیر پروژه" : "تأیید و ارسال به کارفرما"}</button>` : ""}
      <button class="warn" data-act="review" data-id="${report.visit.id}" data-decision="return">${stage === "unit_review" ? "مرجوع به بازرس برای اصلاح" : "مرجوع به مدیر واحد"}</button>
    </div>` : "";
  const clientControls = clientReview ? `
    <div class="actions">
      <button class="primary" data-act="confirm-report" data-id="${report.visit.id}">تأیید نهایی کارفرما و صدور صورتحساب</button>
      <label>دلیل نقص و مرجوعی به مدیر پروژه<input id="client-reject-note-${report.visit.id}" minlength="3" maxlength="2000"></label>
      <button class="warn" data-act="client-reject-report" data-id="${report.visit.id}">مرجوع به مدیر پروژه</button>
    </div>` : "";
  app.innerHTML = shell(
    report.visit.ivr_no,
    `${report.context.equipment.tag} · ${report.context.point.title}`,
    `<article class="card pad detail">
      <p>بازرس: ${esc(report.visit.inspector)} · ${esc(report.visit.city)}</p>
      <p>نتیجه: ${esc(report.visit.result === "accept" ? "قبول" : report.visit.result === "reject" ? "رد" : report.visit.result)} · ${esc(report.visit.report_stage_label || report.visit.phase)}</p>
      <p>${esc(report.visit.note)}</p>
      ${report.visit.review_note ? `<p class="chip wait">یادداشت مرجوعی: ${esc(report.visit.review_note)}</p>` : ""}
      ${report.visit.arrive_distance_km != null ? `<p>فاصله ورود تا کارگاه: ${Number(report.visit.arrive_distance_km).toLocaleString("fa-IR")} کیلومتر</p>` : ""}
      ${report.context.point.request_form_id ? `<section class="card pad"><b>فرم خام IN کارفرما</b><p class="hint">گزارش بازرسی به همین درخواست تأییدشده پیوسته است.</p><button class="ghost" data-act="open-sheet" data-id="${report.context.point.request_form_id}" data-kind="in">مشاهده فرم IN اصلی</button></section>` : ""}
      ${report.context.point.request_form_id && report.visit.report_form_completed ? `<section class="card pad"><b>فرم IN تکمیل‌شدهٔ گزارش بازرسی</b><p class="hint">نسخهٔ این بازدید همراه IVR و پیوست‌ها برای بررسی به مراحل بعد ارسال می‌شود.</p><button class="ghost" data-act="open-visit-report-form" data-id="${report.visit.id}">مشاهده فرم تکمیل‌شدهٔ گزارش</button></section>` : ""}
      <h3>چک‌لیست</h3>
      <ul>${report.answers.map((row) => {
        const item = report.context.point.checklist.find((entry) => entry.id === row.item_id);
        return `<li>${esc(item?.text || row.item_id)}: ${esc(row.value)} ${esc(row.note)}</li>`;
      }).join("")}</ul>
      <h3>مدارک درخواست و پروژه</h3>
      <div class="picked-list">${(report.context.documents || []).map((document) => `
        <div class="person">
          <span>${esc(document.label)} · ${esc(document.title || document.filename || "مدرک")}</span>
          ${document.download_url ? `<a class="ghost" href="${esc(document.download_url)}" target="_blank" rel="noopener">مشاهده / دریافت ${esc(document.filename || "فایل")}</a>` : `<small>فایلی بارگذاری نشده است</small>`}
        </div>`).join("") || `<p class="empty">مدرکی برای این تجهیز بارگذاری نشده است.</p>`}</div>
      <h3>پیوست‌های بازرسی</h3>
      <div class="gallery">${report.photos.map((row) => `<figure>${row.url ? (row.media_type?.startsWith("video/") ? `<video src="${esc(row.url)}" controls></video>` : row.media_type?.startsWith("image/") ? `<img src="${esc(row.url)}" alt="${esc(row.caption)}">` : "") : ""}${row.url ? `<a href="${esc(row.url)}" target="_blank" rel="noopener" download="${esc(row.filename || "")}">مشاهده / دریافت ${esc(row.filename || "پیوست")}</a>` : ""}<figcaption>${esc(row.kind === "inspector_signature" ? "مهر و امضای بازرس" : row.kind === "environment" ? "محیط" : row.kind === "marker" ? "پیکان‌کار" : "مورد بازرسی")} · ${esc(row.caption || row.filename || "")}</figcaption></figure>`).join("") || "<p>پیوستی ثبت نشده است.</p>"}</div>
      ${canAttach ? `<div class="archive-upload"><label>بارگذاری عکس، ویدئو یا مدرک<input id="visit-attachment" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"></label><button class="primary" data-act="upload-visit-attachment" data-id="${report.visit.id}">پیوست به گزارش</button><p class="hint">بارگذاری فقط پس از تأیید موقعیت جغرافیایی فعال است.</p></div>` : ""}
      <h3>گفت‌وگو درباره گزارش</h3>
      <div class="stack">${comments.map((comment) => `<div class="person"><span><b>${esc(comment.author)}</b><small>${esc(comment.body)}</small></span><small>${esc(comment.created_at)}</small></div>`).join("") || "<p>نظری ثبت نشده است.</p>"}</div>
      <div class="archive-upload"><label>نظر یا درخواست اصلاح<textarea id="report-comment" rows="3" maxlength="4000"></textarea></label><button class="primary" data-act="send-comment" data-id="${report.visit.id}">ارسال نظر و اطلاع‌رسانی</button></div>
      <div class="timeline">${report.timeline.map((row) => `<div>${esc(row.at)} · ${esc(row.action)} ${esc(row.detail)}</div>`).join("")}</div>
      ${report.money ? `<p>دستمزد پایه ${money(report.money.fee_irr)} · ایاب‌وذهاب یک‌طرفه ${money(report.money.travel_irr)} · دریافتی بازرس ${money(report.money.net_irr)}</p>` : ""}
      ${reviewControls}
      ${clientControls}
      ${state.me.role !== "buyer" ? `<div class="actions"><button class="ghost" data-act="open-form" data-kind="ivr">فرم خالی IVR</button></div>` : ""}
    </article>`
  );
}

async function renderDocs() {
  const [docs, board] = await Promise.all([api("/api/documents"), api("/api/board")]);
  const equipment = [...new Map(board.map((row) => [row.equipment_id, row])).values()];
  const groupedDocs = new Map();
  for (const doc of docs) {
    const items = groupedDocs.get(doc.equipment_id) || [];
    items.push(doc);
    groupedDocs.set(doc.equipment_id, items);
  }
  const canUpload = ["vendor", "buyer", "coordinator", "admin"].includes(state.me.role);
  app.innerHTML = shell(
    "پرونده ساخت",
    "گواهی مواد، WPS، رویه آزمون، پکینگ‌لیست و نقشه. بدون مدرک لازم، نقطه آماده اعزام نمی‌شود.",
    `${canUpload ? `<article class="card pad archive-upload">
      <h3>بارگذاری مدرک واقعی</h3>
      <p class="hint">فایل‌های PDF، Office و تصویر تا ۱۰۰ مگابایت پذیرفته می‌شوند.</p>
      <div class="archive-upload-fields">
        <label>تجهیز<select id="document-equipment">${equipment.map((item) => `<option value="${item.equipment_id}">${esc(item.tag)} · ${esc(item.equipment)}</option>`).join("")}</select></label>
        <label>نوع مدرک<select id="document-type">${Object.entries(DOC_TYPES).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select></label>
        <label>فایل<input id="document-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"></label>
        <button class="primary" data-act="upload-document">بارگذاری و ثبت</button>
      </div>
    </article>` : ""}
    <article class="card pad"><h3>پرونده‌های هر تجهیز</h3>
      ${equipment.map((item) => {
        const files = groupedDocs.get(item.equipment_id) || [];
        return `<details class="archive-equipment">
          <summary><b>${esc(item.tag)}</b> · ${esc(item.equipment)} <span class="chip">${files.length.toLocaleString("fa-IR")} مدرک</span></summary>
          <div class="tablewrap"><table><thead><tr><th>نوع</th><th>پرونده</th><th>دسترسی</th></tr></thead><tbody>
            ${files.map((doc) => `<tr><td>${esc(doc.label)}</td><td>${esc(doc.filename)}</td><td>${doc.download_url ? `<a href="${esc(doc.download_url)}">دریافت فایل</a>` : "فقط نام فایل ثبت شده؛ فایل واقعی موجود نیست"}</td></tr>`).join("") || `<tr><td colspan="3">مدرکی برای این تجهیز ثبت نشده است.</td></tr>`}
          </tbody></table></div>
        </details>`;
      }).join("") || `<p class="empty">تجهیزی ثبت نشده است.</p>`}
    </article>`
  );
}

function archivePhoto(photo) {
  return `<figure class="archive-photo">
    ${photo.url ? `<a href="${esc(photo.url)}" target="_blank" rel="noopener"><img src="${esc(photo.url)}" alt="${esc(photo.label)}"></a>` : `<div class="archive-photo-empty">فایل عکس ثبت نشده</div>`}
    <figcaption>${esc(photo.label)} · ${esc(photo.caption)}</figcaption>
  </figure>`;
}

async function renderArchive() {
  const projects = await api("/api/archive/projects");
  const cards = projects.map((project) => `
    <article class="card pad archive-project">
      <div class="split">
        <div><p class="eyebrow">${esc(project.code)} · پروژه مناقصه‌ای</p><h2>${esc(project.name)}</h2></div>
        <button class="ghost" data-act="print-archive">چاپ آرشیو</button>
      </div>
      <p>${esc(project.buyer)} · ${esc(project.vendors.join("، "))} · سفارش ${esc(project.purchase_orders.join("، "))}</p>
      <div class="archive-stats">
        <span>${project.completed_points.toLocaleString("fa-IR")} از ${project.total_points.toLocaleString("fa-IR")} نقطه دارای گزارش تأییدشده</span>
        <span>${project.reports.toLocaleString("fa-IR")} گزارش · ${project.client_approved_reports.toLocaleString("fa-IR")} تأیید نهایی کارفرما</span>
      </div>
      ${project.equipment.map((item) => `
        <section class="archive-equipment">
          <h3>${esc(item.tag)} · ${esc(item.title)}</h3>
          <p class="hint">${esc(item.workshop)}</p>
          <h4>مدارک بارگذاری‌شده</h4>
          <ul class="archive-docs">${item.documents.map((doc) => `<li><span>${esc(doc.label)} · ${esc(doc.filename)} · ${esc(doc.uploaded_by || "نامشخص")}</span>${doc.download_url ? `<a href="${esc(doc.download_url)}">مشاهده فایل</a>` : `<small>نام فایل ثبت شده؛ فایل واقعی در آرشیو نیست</small>`}</li>`).join("") || `<li>مدرکی ثبت نشده است.</li>`}</ul>
          ${item.completed_points.map((point) => `
            <section class="archive-inspection">
              <h4>${point.seq.toLocaleString("fa-IR")}. ${esc(point.title)} · ${esc(point.discipline)}</h4>
              ${point.reports.map((report) => `
                <article class="archive-report">
                  <div class="split">
                    <b>${esc(report.ivr_no)} · بازرس: ${esc(report.inspector || "نامشخص")}</b>
                    <span class="chip ${report.signature_verified ? "ok" : "wait"}">${report.signature_verified ? "ثبت سامانه‌ای با حساب بازرس" : "امضای سامانه‌ای قابل تأیید نیست"}</span>
                  </div>
                  <p>ثبت گزارش: ${esc(report.signed_at || report.submitted_at || "نامشخص")} · ${report.client_approved ? "تأیید نهایی کارفرما" : "در انتظار تأیید نهایی کارفرما"}</p>
                  ${report.signed_by ? `<p>ثبت‌کنندهٔ رویداد امضا: ${esc(report.signed_by)}</p>` : ""}
                  <button class="ghost" data-act="open-ivr" data-id="${report.visit_id}">مشاهده گزارش و چک‌لیست</button>
                  <h5>عکس‌های محل و تجهیزات بازرسی</h5>
                  <div class="archive-gallery">${report.photos.map(archivePhoto).join("") || `<p>عکسی برای این گزارش ثبت نشده است.</p>`}</div>
                </article>`).join("")}
            </section>`).join("") || `<p class="hint">گزارش بازرسی تأییدشده‌ای برای این تجهیز نیست.</p>`}
        </section>`).join("")}
    </article>`).join("");
  app.innerHTML = shell(
    "آرشیو پروژه‌های بازرسی",
    "پروژه‌های دارای سفارش خرید و گزارش بازرسی تأییدشده؛ شامل مدارک، گزارش ثبت‌شده با حساب بازرس و عکس‌های محل و تجهیزات.",
    `<div class="archive-list">${cards || `<article class="card pad empty">هنوز پروژه‌ای با گزارش بازرسی تأییدشده در آرشیو وجود ندارد.</article>`}</div>`
  );
}

async function renderMoms() {
  const moms = await api("/api/moms");
  app.innerHTML = shell(
    "صورتجلسه‌ها",
    "MOM جلسه هماهنگی، جدا از گزارش بازدید است.",
    `<div class="detail">${moms.map((mom) => `<article class="card pad"><h3>${esc(mom.title)}</h3><p>${esc(mom.held_on)} · ${esc(mom.attendees)}</p><p>${esc(mom.body)}</p></article>`).join("")}
      <article class="card pad"><h3>صورتجلسه تازه</h3><p>فرم MOM جاهای خالی حاضرین، اقدام و امضا دارد.</p><button class="primary" data-act="open-form" data-kind="mom">فرم خالی MOM</button></article>
    </div>`
  );
}

function historyBlock(rows, currentVisitId) {
  const prior = (rows || []).filter((row) => row.visit_id !== currentVisitId);
  if (!prior.length) return `<p class="hint">گزارش مرحلهٔ قبلی برای این تجهیز نیست.</p>`;
  return `<section class="history"><h3>بازرسی‌های قبلی</h3>${prior.map((row) => `
    <article class="past ${row.defects.length ? "bad" : ""}">
      <b>${row.seq.toLocaleString("fa-IR")}. ${esc(row.title)}${row.same_point ? " · همین نقطه" : ""}</b>
      <small>${esc(row.ivr_no)} · ${esc(row.inspector)} · ${row.result === "reject" ? "رد شده" : row.result === "accept" ? "قبول شده" : "جاری"}</small>
      ${row.note ? `<p>${esc(row.note)}</p>` : ""}
      ${row.defects.length ? `<ul>${row.defects.map((defect) => `<li>${esc(defect.text)} — ${esc(defect.note)}</li>`).join("")}</ul>` : `<p>ایرادی ثبت نشده</p>`}
      <button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">گزارش این مرحله</button>
    </article>`).join("")}</section>`;
}

function blankControl(field, value, disabled = false) {
  const wide = field.kind === "area" ? " span2" : "";
  const readonly = disabled ? " disabled" : "";
  const required = field.required && !disabled ? " required aria-required=\"true\"" : "";
  const label = `${esc(field.label)}${field.required ? ` <b class="required-star" aria-hidden="true">*</b>` : ""}`;
  if (field.kind === "select" && field.key === "customer_location") {
    const selected = value || "iran";
    const options = selected === "international"
      ? [["iran", "Iran"], ["international", "International / خارج از ایران"]]
      : [["iran", "ایران / داخل کشور"], ["international", "International / خارج از ایران"]];
    return `<label class="blank"><span>${label}</span><select data-form-key="${esc(field.key)}"${readonly}${required}>${options.map(([key, label]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  }
  if (field.kind === "area") {
    return `<label class="blank${wide}"><span>${label}</span><textarea data-form-key="${esc(field.key)}" rows="3"${readonly}${required}>${esc(value || "")}</textarea></label>`;
  }
  return `<label class="blank${wide}"><span>${label}</span><input data-form-key="${esc(field.key)}" value="${esc(value || "")}"${readonly}${required}></label>`;
}

function adaptInTablePayload(sheet) {
  const payload = sheet.payload || {};
  (sheet.tables || []).forEach((table) => {
    if (Array.isArray(payload[table.key])) return;
    const text = typeof payload[table.key] === "string" ? payload[table.key].trim() : "";
    const fallbackKey = table.key === "materials" ? "material" : table.key === "items" ? "item" : table.columns[0]?.key;
    const firstRow = Object.fromEntries(table.columns.map(({ key }) => [key, ""]));
    if (text && fallbackKey) firstRow[fallbackKey] = text;
    payload[table.key] = [firstRow];
  });
  sheet.payload = payload;
  return sheet;
}

function buyerInField(label, key, payload, options = {}) {
  const { placeholder = "", type = "text", wide = false, disabled = false } = options;
  return `<label class="buyer-in-field${wide ? " wide" : ""}"><span>${esc(label)}</span><input type="${type}" data-form-key="${esc(key)}" value="${esc(payload[key] || "")}" placeholder="${esc(placeholder)}"${disabled ? " disabled" : ""}></label>`;
}

function buyerInSelect(label, key, payload, values, disabled = false) {
  const selected = payload[key] || "";
  const options = [...new Set([selected, ...values].filter(Boolean))];
  return `<label class="buyer-in-field"><span>${esc(label)}</span><select data-form-key="${esc(key)}"${disabled ? " disabled" : ""}>
    ${options.map((value) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("")}
  </select></label>`;
}

function buyerInTable(table, rows, { english = false, disabled = false } = {}) {
  const labels = {
    reference_documents: {
      title: english ? "Document Title" : "عنوان سند",
      document_no: english ? "Document No." : "شماره سند",
      issue_date: english ? "Issue Date" : "تاریخ صدور",
      revision: english ? "Revision / Code" : "ویرایش / کد",
    },
    materials: {
      item_no: english ? "Item No." : "ردیف",
      material: english ? "Material Description" : "شرح کالا / مواد",
      unit: english ? "Unit" : "واحد",
      quantity: english ? "Quantity" : "تعداد",
      test_frequency: english ? "Test Frequency" : "تناوب آزمون",
    },
    items: {
      item_no: english ? "Item No." : "ردیف",
      item: english ? "Item Name" : "نام کالا",
      unit: english ? "Unit" : "واحد",
      quantity: english ? "Quantity" : "تعداد",
      description: english ? "Description" : "توضیحات",
    },
  };
  const columns = table.columns.map((column) => ({ ...column, label: labels[table.key]?.[column.key] || column.label }));
  const visibleColumns = english && table.key === "reference_documents"
    ? columns.filter((column) => column.key !== "issue_date")
    : columns;
  const rowList = rows?.length ? rows : [Object.fromEntries(columns.map(({ key }) => [key, ""]))];
  const placeholders = {
    "reference_documents.title": english ? "Enter document title..." : "عنوان سند را وارد کنید...",
    "reference_documents.document_no": english ? "Enter document number..." : "شماره سند",
    "reference_documents.issue_date": english ? "YYYY/MM/DD" : "۱۴۰۳/۰۷/۱۵",
    "reference_documents.revision": english ? "Enter revision/code..." : "ویرایش / کد",
    "materials.material": english ? "e.g., Class 300 Valve" : "شرح کالا یا مواد",
    "materials.unit": english ? "e.g., pcs" : "واحد",
    "materials.quantity": english ? "e.g., 5 pcs..." : "مثلاً ۵ عدد",
    "materials.test_frequency": english ? "e.g., Once per batch..." : "مثلاً یک‌بار در هر محموله",
    "items.item": "نام کالا",
    "items.quantity": "تعداد",
    "items.description": "توضیحات",
  };
  return `<section class="buyer-in-table-section">
    <h3>${esc(table.key === "reference_documents" ? (english ? "REFERENCE DOCUMENTS (P/O, ITP, Standards, Procedure, etc.)" : "اسناد مرجع") : table.key === "materials" ? (english ? "EXTRA INFORMATION & REMARKS" : "اطلاعات و اقلام اضافی") : (english ? "ITEM DESCRIPTION" : "شرح کالا"))}</h3>
    <div class="tablewrap"><table class="buyer-in-table"><thead><tr><th>${english ? "Row" : "ردیف"}</th>${visibleColumns.map((column) => `<th>${esc(column.label)}</th>`).join("")}<th>${english ? "Actions" : "عملیات"}</th></tr></thead>
      <tbody class="buyer-in-table-body" data-form-table-body="${esc(table.key)}">${rowList.map((row, index) => `<tr data-form-row="${index}">
        <td>${(index + 1).toLocaleString(english ? "en-US" : "fa-IR")}</td>
        ${visibleColumns.map((column) => `<td><input data-form-table="${esc(table.key)}" data-row="${index}" data-col="${esc(column.key)}" value="${esc(row?.[column.key] || "")}" placeholder="${esc(placeholders[`${table.key}.${column.key}`] || "")}"${disabled ? " disabled" : ""}></td>`).join("")}
        <td><button class="buyer-remove-row" type="button" data-act="remove-form-row" data-table="${esc(table.key)}" data-row="${index}" aria-label="${english ? "Remove row" : "حذف ردیف"}"${disabled ? " disabled" : ""}>×</button></td>
      </tr>`).join("")}</tbody></table></div>
    ${disabled ? "" : `<button class="buyer-add-row" type="button" data-act="add-form-row" data-table="${esc(table.key)}">＋ ${english ? "Add Row" : "افزودن ردیف"}</button>`}
  </section>`;
}

function buyerInMap(payload, disabled) {
  const streets = `<svg viewBox="0 0 640 120" role="img" aria-label="پیش‌نمایش نقشهٔ محل بازرسی">
    <rect width="640" height="120" fill="#e7eef0"/>
    <path d="M-20 92 130 25 245 118 380 20 660 94M32-10 110 130M290-20 338 130M512-10 440 130M-10 50 650 60" fill="none" stroke="#fff" stroke-width="14"/>
    <path d="M-20 92 130 25 245 118 380 20 660 94M32-10 110 130M290-20 338 130M512-10 440 130M-10 50 650 60" fill="none" stroke="#c8d6dd" stroke-width="2"/>
    <circle cx="330" cy="58" r="13" fill="#c13e35"/><circle cx="330" cy="58" r="5" fill="#fff"/>
  </svg>`;
  return `<section class="buyer-in-location-card">
    <div>${buyerInField("نشانی دقیق محل بازرسی", "location_address", payload, { placeholder: "نشانی کارگاه / محل بازرسی", disabled })}</div>
    <div class="buyer-in-map-controls">${buyerInSelect("شهر", "location_city", payload, ["تهران", "اصفهان", "شیراز", "تبریز", "مشهد", "اهواز", "قزوین"], disabled)}</div>
    <div class="buyer-in-map-preview">${streets}</div>
  </section>`;
}

function buyerInCountry(payload, disabled) {
  const countries = [
    "Germany",
    "United Arab Emirates",
    "Saudi Arabia",
    "Turkey",
    "China",
    "India",
    "Italy",
    "France",
    "United Kingdom",
    "United States",
    "Other",
  ];
  const selected = payload.location || "";
  const options = [...new Set([selected, ...countries].filter(Boolean))];
  return `<label class="buyer-in-field buyer-in-country"><span>Inspection Location:</span><span class="buyer-in-country-control">
    <select data-form-key="location"${disabled ? " disabled" : ""}>
      <option value="" ${selected ? "" : "selected"}>Select country...</option>
      ${options.map((country) => `<option value="${esc(country)}" ${country === selected ? "selected" : ""}>${esc(country)}</option>`).join("")}
    </select>
    <button class="buyer-location-search" type="button" data-act="search-location" aria-label="Search location in maps" title="Search location in maps"${disabled ? " disabled" : ""}>⌕</button>
  </span></label>`;
}

function buyerInRequestForm(sheet, payload, { disabled, canSubmitRequest, pointOptions = "" }) {
  const international = payload.customer_location === "international";
  const findTable = (key) => (sheet.tables || []).find((table) => table.key === key);
  const actions = canSubmitRequest
    ? `<div class="buyer-in-form-actions"><button class="primary" data-act="save-form">✓ ${international ? "Submit" : "ثبت نهایی"}</button><button class="ghost" data-act="cancel-in-form">× ${international ? "Cancel" : "انصراف"}</button></div>`
    : "";
  if (international) {
    const left = [
      buyerInField("Client:", "client", payload, { placeholder: "Enter client name...", disabled }),
      buyerInField("Contractor:", "contractor", payload, { placeholder: "Enter contractor name...", disabled }),
      buyerInField("Vendor:", "vendor", payload, { placeholder: "Enter vendor name...", disabled }),
      buyerInField("PO No.:", "po", payload, { placeholder: "PO-1403-XXXX", disabled }),
      buyerInField("Inspection Date:", "inspection_date", payload, { type: "date", disabled }),
    ].join("");
    const right = [
      buyerInField("Project Name:", "project", payload, { placeholder: "Enter project name...", disabled }),
      buyerInField("MC:", "mc", payload, { placeholder: "Enter MC...", disabled }),
      buyerInField("Manufacturer:", "manufacturer", payload, { placeholder: "Enter manufacturer...", disabled }),
      buyerInField("P/I No.:", "pi", payload, { placeholder: "Enter P/I No...", disabled }),
      buyerInField("Inspection Duration:", "duration", payload, { placeholder: "e.g., 3 days...", disabled }),
    ].join("");
    const representative = [
      buyerInField("Vendor's Representative:", "vendor_representative", payload, { placeholder: "Enter representative name...", disabled }),
      buyerInField("Mobile No.:", "mobile", payload, { placeholder: "Enter mobile number...", disabled }),
    ].join("");
    const contact = [
      buyerInField("Contact Phone No.:", "contact_phone", payload, { placeholder: "Enter phone number...", disabled }),
      buyerInField("Email Address:", "email", payload, { placeholder: "Enter email address...", disabled }),
    ].join("");
    return `<article class="buyer-in-sheet buyer-international" dir="ltr">
      <header class="buyer-in-sheet-title"><span>⌖</span><h2>INSPECTION NOTIFICATION NO.</h2><strong>${esc(payload.number || "—")}</strong>${pointOptions}</header>
      <div class="buyer-in-two-cards"><section class="buyer-in-fields-card">${left}</section><section class="buyer-in-fields-card">${right}</section></div>
      <div class="buyer-in-two-cards buyer-in-contact-cards"><section class="buyer-in-fields-card">${representative}</section><section class="buyer-in-fields-card">${contact}</section></div>
      ${buyerInCountry(payload, disabled)}
      ${buyerInTable(findTable("reference_documents"), payload.reference_documents, { english: true, disabled })}
      ${buyerInTable(findTable("materials"), payload.materials, { english: true, disabled })}
      <label class="buyer-in-field buyer-in-remarks"><span>Remarks:</span><textarea data-form-key="remarks" rows="2"${disabled ? " disabled" : ""} placeholder="Enter any additional information or remarks here...">${esc(payload.remarks || "")}</textarea></label>
      ${actions}
    </article>`;
  }
  const left = [
    buyerInField("پیمانکار", "contractor", payload, { placeholder: "نام پیمانکار را وارد کنید...", disabled }),
    buyerInField("نام پروژه", "project", payload, { placeholder: "عنوان پروژه را وارد کنید...", disabled }),
    buyerInField("کد پروژه", "project_code", payload, { placeholder: "کد پروژه", disabled }),
  ].join("");
  const right = [
    buyerInField("مشتری", "client", payload, { placeholder: "نام مشتری را وارد کنید...", disabled }),
    buyerInField("شماره PO", "po", payload, { placeholder: "PO-1403-XXXX", disabled }),
    buyerInField("تاریخ بازرسی", "inspection_date", payload, { type: "date", disabled }),
  ].join("");
  return `<article class="buyer-in-sheet buyer-in-domestic" dir="rtl">
    <header class="buyer-in-sheet-title"><span>⌖</span><h2>ثبت IN داخل کشور</h2><strong>${esc(payload.number || "—")}</strong></header>
    <div class="buyer-in-two-cards"><section class="buyer-in-fields-card">${left}</section><section class="buyer-in-fields-card">${right}</section></div>
    ${buyerInMap(payload, disabled)}
    ${buyerInTable(findTable("reference_documents"), payload.reference_documents, { disabled })}
    ${buyerInTable(findTable("items"), payload.items, { disabled })}
    <label class="buyer-in-field buyer-in-remarks"><span>توضیحات تکمیلی</span><textarea data-form-key="remarks" rows="2"${disabled ? " disabled" : ""} placeholder="اطلاعات و توضیحات تکمیلی را وارد کنید...">${esc(payload.remarks || "")}</textarea></label>
    ${actions}
  </article>`;
}

function todayForInput() {
  const parts = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function prefillInspectionRequest(detail) {
  return {
    customer_location: "iran",
    client: detail.companies.buyer,
    project: detail.project.name,
    project_code: detail.project.code,
    po: detail.order.number,
    inspection_date: todayForInput(),
    contractor: detail.companies.vendor,
    vendor: detail.companies.vendor,
    manufacturer: detail.companies.vendor,
    location: `${detail.equipment.workshop_name}، ${detail.equipment.city}`,
    location_address: detail.equipment.workshop_name,
    location_city: detail.equipment.city,
    tag: detail.equipment.tag,
    itp_item: String(detail.point.seq),
    discipline: detail.point.discipline_label,
    reference: detail.point.standard_ref,
    scope: detail.point.title,
    category: "درخواست بازرسی",
  };
}

function prefillInspectionRequestForLocation(detail, customerLocation) {
  return {
    ...prefillInspectionRequest(detail),
    customer_location: customerLocation,
    ...(customerLocation === "international" ? { location: "" } : {}),
  };
}

function blankTable(table, rows, disabled = false) {
  const readonly = disabled ? " disabled" : "";
  const body = (rows || []).map((row, index) => `<tr>${table.columns.map((column) => {
    const required = column.required && index === 0 && !disabled ? " required aria-required=\"true\"" : "";
    return `<td><input data-form-table="${esc(table.key)}" data-row="${index}" data-col="${esc(column.key)}" value="${esc((row || {})[column.key] || "")}"${readonly}${required}></td>`;
  }).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table class="blanksheet"><thead><tr>${table.columns.map((column) => `<th>${esc(column.label)}${column.required ? ` <b class="required-star" aria-hidden="true">*</b>` : ""}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function collectForm() {
  const spec = state.formSpec;
  const payload = { ...(spec.payload || {}) };
  document.querySelectorAll("[data-form-key]").forEach((el) => {
    payload[el.dataset.formKey] = el.value;
  });
  (spec.tables || []).forEach((table) => {
    const inputs = document.querySelectorAll(`[data-form-table="${table.key}"]`);
    if (!inputs.length) return;
    const indexedRows = new Map();
    inputs.forEach((input) => {
      const index = Number(input.dataset.row);
      if (!indexedRows.has(index)) indexedRows.set(index, {});
      indexedRows.get(index)[input.dataset.col] = input.value;
    });
    payload[table.key] = [...indexedRows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, row]) => row);
  });
  if (payload.customer_location !== "international" && ("location_address" in payload || "location_city" in payload)) {
    const location = [payload.location_address, payload.location_city].filter(Boolean).join("، ");
    if (location) payload.location = location;
  }
  if (spec.tail) {
    spec.tail.fields.forEach((field) => {
      const input = document.querySelector(`[data-form-key="${field.key}"]`);
      payload[field.key] = input ? input.value : "";
    });
  }
  return payload;
}

async function renderForms() {
  if (state.visitReportId) {
    const sheet = adaptInTablePayload(await api(`/api/visits/${state.visitReportId}/in-report-form`));
    const displaySheet = sheet.payload.customer_location === "international" ? localizeInSheet(sheet) : sheet;
    state.formSpec = sheet;
    const viewOnly = !sheet.can_edit;
    app.innerHTML = shell(
      "فرم IN تکمیل‌شدهٔ گزارش بازرسی",
      `${sheet.payload.number || "IN"} · گزارش بازدید ${state.visitReportId}`,
      `<div class="formpage">
        <div class="formtabs">
          ${sheet.can_edit ? `<button class="primary" data-act="save-visit-report-form">ذخیره نسخهٔ گزارش</button>` : `<span class="chip ok">نسخهٔ ثبت‌شده · فقط‌خواندنی</span>`}
          <button class="ghost" data-act="open-sheet" data-id="${sheet.id}" data-kind="in">مشاهده IN اصلی</button>
          <button class="ghost" data-act="back">بازگشت به گزارش بازرسی</button>
          <button class="ghost" data-act="print-form">چاپ</button>
        </div>
        <article class="sheet" id="sheet">
          <header class="sheet-head"><div><b>${esc(displaySheet.code)}</b><h2>${esc(displaySheet.title)}</h2><p>${esc(displaySheet.title_fa)} — نسخهٔ گزارش بازرسی</p></div><div class="sheet-no"><span>شماره</span><strong>${esc(sheet.payload.number || "—")}</strong></div></header>
          <p class="hint">${esc(displaySheet.note)}</p>
          ${displaySheet.sections.map((section) => `<section><h3>${esc(section.title)}</h3><div class="blanks">${section.fields.filter((field) => !displaySheet.tables?.some((table) => table.key === field.key)).map((field) => blankControl(field, sheet.payload[field.key], viewOnly)).join("")}</div></section>`).join("")}
          ${(displaySheet.tables || []).map((table) => `<section><h3>${esc(table.title)}</h3>${blankTable(table, sheet.payload[table.key], viewOnly)}</section>`).join("")}
        </article>
        ${sheet.can_edit ? `<div class="form-submit-sticky"><p><b>ثبت نسخهٔ گزارش</b><span>مدت و شرح بازرسی اجباری است؛ IN اصلی کارفرما تغییر نمی‌کند.</span></p><button class="primary" data-act="save-visit-report-form">ذخیره نسخهٔ گزارش</button></div>` : ""}
      </div>`
    );
    return;
  }
  const kind = state.inRequestMode || state.requestPointId ? "in" : state.me.role === "buyer" ? "in" : state.formKind || "ivr";
  const [sheet, saved, requestBoard] = await Promise.all([
    state.formId ? api(`/api/forms/${state.formId}`) : api(`/api/forms/template/${kind}`),
    (state.formId && kind === "in")
      || (state.me.role === "manager" && kind === "in")
      || (state.me.role === "buyer" && !state.requestPointId)
      ? Promise.resolve([])
      : api(`/api/forms?kind=${kind}`),
    state.inRequestMode ? api(`/api/board?kind=${state.kind === "case" ? "case" : "project"}`) : Promise.resolve([]),
  ]);
  if (kind === "in") adaptInTablePayload(sheet);
  if (state.requestPrefill && !state.formId) sheet.payload = { ...sheet.payload, ...state.requestPrefill };
  if (state.formDraft && !state.formId) sheet.payload = { ...sheet.payload, ...state.formDraft };
  const displaySheet = kind === "in" && sheet.payload.customer_location === "international"
    ? localizeInSheet(sheet)
    : sheet;
  state.formSpec = sheet;
  const viewOnly = (["manager", "unit_manager", "inspector"].includes(state.me.role) && kind === "in" && Boolean(state.formId))
    || (state.me.role === "buyer" && !state.inRequestMode);
  const formDisabled = viewOnly || (state.inRequestMode && !state.requestPointId);
  const canSubmitRequest = state.inRequestMode && Boolean(state.requestPointId);
  const buyerInRequest = kind === "in" && state.me.role === "buyer";
  const internationalIn = buyerInRequest && sheet.payload.customer_location === "international";
  const tabs = kind === "in"
    ? [["in", "IN"]]
    : state.me.role === "executive_manager"
    ? [["in", "IN"], ["itp", "ITP"], ["ivr", "IVR"], ["mom", "MOM"]]
    : state.me.role === "buyer" ? [["in", "IN"]] : [["ivr", "IVR"]];
  const internationalPointOptions = state.inRequestMode
    && internationalIn
    && state.requestPoints.length
    ? `<label class="buyer-in-point-select" aria-label="Inspection Point"><span class="sr-only">Inspection Point</span><select data-buyer-in-point aria-label="Inspection Point">${state.requestPoints.map((point) => `<option value="${point.id}" ${Number(point.id) === Number(state.requestPointId) ? "selected" : ""}>${esc(point.tag)} · ${esc(point.title)}</option>`).join("")}</select></label>`
    : "";
  app.innerHTML = shell(
    buyerInRequest ? (internationalIn ? "New IN Registration" : "ثبت IN داخل کشور") : `${displaySheet.code} · ${displaySheet.title_fa}`,
    buyerInRequest ? (internationalIn ? "Inspection Notification" : "درخواست یادداشت بازرسی") : displaySheet.title,
    `<div class="formpage">
      ${buyerInRequest ? `<div class="buyer-in-top-actions"><button class="ghost" data-act="print-form">${internationalIn ? "Print form" : "چاپ فرم"}</button></div>` : `<div class="formtabs">
        ${tabs.map(([id, label]) => `<button class="ghost ${kind === id ? "on" : ""}" data-act="form-kind" data-kind="${id}">${label}</button>`).join("")}
        ${canSubmitRequest ? `<label><input id="request-remote" type="checkbox"> درخواست بازرسی از راه دور</label>` : ""}
        ${!state.requestPointId ? `<button class="ghost" data-act="new-form">فرم تازه</button>` : ""}
        <button class="ghost" data-act="print-form">چاپ</button>
        ${!viewOnly && (!state.inRequestMode || canSubmitRequest) ? `<button class="primary" data-act="save-form">${canSubmitRequest ? "ثبت نهایی IN و ارسال به کارتابل مدیر پروژه" : "ثبت جاهای پر شده"}</button>` : ""}
      </div>`}
      ${state.inRequestMode && !buyerInRequest ? inRequestPointChooser(requestBoard, state.requestPointId) : ""}
      ${state.inRequestMode && !state.requestPointId ? `<p class="chip wait">برای تکمیل فرم، ابتدا نقطهٔ بازرسی را از فهرست بالا انتخاب کنید.</p>` : ""}
      <div class="formlayout ${buyerInRequest ? "buyer-in-formlayout" : ""}">
        ${buyerInRequest ? buyerInRequestForm(displaySheet, sheet.payload, { disabled: formDisabled, canSubmitRequest, pointOptions: internationalPointOptions }) : `<article class="sheet" id="sheet">
          <header class="sheet-head">
            <div><b>${esc(displaySheet.code)}</b><h2>${esc(displaySheet.title)}</h2><p>${esc(displaySheet.title_fa)}</p></div>
            <div class="sheet-no"><span>شماره</span><strong>${esc(sheet.payload.number || "—")}</strong></div>
          </header>
          <p class="hint">${viewOnly && state.me.role === "inspector" ? "فرم IN خام و تأییدشدهٔ کارفرما؛ فقط برای مشاهده و مبنای تکمیل گزارش بازرسی." : esc(displaySheet.note)}</p>
          ${displaySheet.sections.map((section) => `<section><h3>${esc(section.title)}</h3><div class="blanks">${section.fields.filter((field) => !displaySheet.tables?.some((table) => table.key === field.key)).map((field) => blankControl(field, sheet.payload[field.key], formDisabled)).join("")}</div></section>`).join("")}
          ${(displaySheet.tables || []).map((table) => `<section><h3>${esc(table.title)}</h3>${blankTable(table, sheet.payload[table.key], formDisabled)}</section>`).join("")}
          ${displaySheet.tail ? `<section><h3>${esc(displaySheet.tail.title)}</h3><div class="blanks">${displaySheet.tail.fields.map((field) => blankControl(field, sheet.payload[field.key], formDisabled)).join("")}</div></section>` : ""}
        </article>
        <aside class="card pad">
          <h3>پیش‌نویس‌های ${esc(sheet.code)}</h3>
          <div class="stack">
            ${saved.map((item) => `<button class="picked" data-act="open-sheet" data-id="${item.id}" data-kind="${item.kind}"><b>${esc(item.number)}</b><small>${esc(item.updated_at)}</small></button>`).join("") || `<p class="empty">هنوز فرمی ثبت نشده. جاهای خالی را پر کنید.</p>`}
          </div>
        </aside>`}
      </div>
      ${canSubmitRequest && !buyerInRequest ? `<div class="form-submit-sticky">
        <p><b>ثبت نهایی درخواست بازرسی</b><span>فرم IN ذخیره و برای بررسی به کارتابل مدیر پروژه ارسال می‌شود.</span></p>
        <button class="primary" data-act="save-form">ثبت نهایی IN و ارسال به کارتابل مدیر پروژه</button>
      </div>` : ""}
    </div>`
  );
}

async function renderNotifications() {
  const rows = await api("/api/notifications");
  app.innerHTML = shell(
    "اعلان‌ها",
    "پیام‌های مربوط به درخواست‌های بازرسی، گزارش‌ها و مدارک ناقص.",
    `<article class="card pad stack">${rows.map((row) => row.target?.type === "ivr"
      ? `<button class="notification-link" data-act="open-ivr" data-id="${row.target.id}">
          <span><b>${esc(row.title)}</b><small>${esc(row.body)}</small></span>
          <span class="notification-action">${row.read ? "مشاهدهٔ گزارش" : "جدید · مشاهدهٔ گزارش"}</span>
        </button>`
      : `<div class="person"><span><b>${esc(row.title)}</b><small>${esc(row.body)}</small></span><small>${row.read ? "خوانده‌شده" : "جدید"}</small></div>`
    ).join("") || `<p class="empty">اعلانی ثبت نشده است.</p>`}</article>`
  );
}

function persianDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tehran",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function persianMonthStart(offset) {
  let start = new Date();
  start.setHours(12, 0, 0, 0);
  while (persianDateParts(start).day !== 1) {
    start.setDate(start.getDate() - 1);
  }
  for (let step = 0; step < Math.abs(offset); step += 1) {
    const direction = offset > 0 ? 1 : -1;
    const probe = new Date(start);
    probe.setDate(probe.getDate() + direction);
    for (let day = 0; day < 33; day += 1) {
      if (persianDateParts(probe).day === 1) {
        start = probe;
        break;
      }
      probe.setDate(probe.getDate() + direction);
    }
  }
  const startParts = persianDateParts(start);
  if (startParts.day !== 1) {
    const probe = new Date(start);
    for (let day = 0; day < 32; day += 1) {
      probe.setDate(probe.getDate() - 1);
      if (persianDateParts(probe).day === 1) return probe;
    }
  }
  return start;
}

function persianDateKey(date) {
  const { year, month, day } = persianDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function renderCalendar() {
  const moments = await api("/api/moms");
  const start = persianMonthStart(state.calendarOffset);
  const monthParts = persianDateParts(start);
  const monthTitle = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Tehran",
  }).format(start);
  const days = [];
  const cursor = new Date(start);
  while (true) {
    const parts = persianDateParts(cursor);
    if (parts.year !== monthParts.year || parts.month !== monthParts.month) break;
    days.push({ key: persianDateKey(cursor), day: parts.day });
    cursor.setDate(cursor.getDate() + 1);
  }
  const eventsByDate = new Map();
  moments.forEach((moment) => {
    const day = String(moment.held_on || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const events = eventsByDate.get(day) || [];
    events.push(moment);
    eventsByDate.set(day, events);
  });
  const firstOffset = (start.getDay() + 1) % 7;
  const calendarCells = [
    ...Array.from({ length: firstOffset }, () => `<div class="calendar-cell calendar-blank" aria-hidden="true"></div>`),
    ...days.map(({ key, day }) => {
      const events = eventsByDate.get(key) || [];
      const today = key === persianDateKey(new Date());
      return `<article class="calendar-cell ${today ? "today" : ""} ${events.length ? "has-events" : ""}">
        <b>${day.toLocaleString("fa-IR")}</b>
        ${events.map((event) => `<span title="${esc(event.title)}">${esc(event.title)}</span>`).join("")}
      </article>`;
    }),
  ];
  const monthEvents = moments.filter((moment) => eventsByDate.has(String(moment.held_on || "").slice(0, 10))
    && String(moment.held_on).slice(0, 7) === `${monthParts.year}-${String(monthParts.month).padStart(2, "0")}`);
  app.innerHTML = shell(
    "تقویم و برنامه‌ریزی",
    "جلسه‌ها و یادداشت‌های ثبت‌شدهٔ پروژه در تقویم شمسی",
    `<section class="calendar-layout">
      <article class="card pad calendar-board">
        <div class="calendar-heading">
          <button class="ghost" data-act="calendar-next" aria-label="ماه بعد">ماه بعد ←</button>
          <h2>${esc(monthTitle)}</h2>
          <button class="ghost" data-act="calendar-prev" aria-label="ماه قبل">→ ماه قبل</button>
        </div>
        <div class="calendar-grid calendar-weekdays">${["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"].map((day) => `<b>${day}</b>`).join("")}</div>
        <div class="calendar-grid">${calendarCells.join("")}</div>
      </article>
      <aside class="card pad calendar-agenda">
        <div class="split"><h3>رویدادهای این ماه</h3><span class="chip">${monthEvents.length.toLocaleString("fa-IR")}</span></div>
        <div class="calendar-events">${monthEvents.map((event) => `<article class="calendar-event">
          <time>${esc(event.held_on)}</time><b>${esc(event.title)}</b><p>${esc(event.body)}</p><small>${esc(event.attendees || "شرکت‌کنندگان ثبت نشده‌اند")}</small>
        </article>`).join("") || `<p class="empty">برای این ماه جلسه‌ای ثبت نشده است.</p>`}</div>
        <button class="primary" data-act="goto" data-view="moms">ثبت / مشاهدهٔ صورتجلسه‌ها</button>
      </aside>
    </section>`
  );
}

function renderRegistration() {
  app.innerHTML = shell(
    "ثبت‌نام اعضا",
    "پیش‌نمایش اطلاعات هویتی و فایل‌های موردنیاز",
    `<article class="card pad">
      <p class="chip wait">بارگذاری مهر و امضا در فاز توسعه غیرفعال است</p>
      <div class="grid2">
        <label>نام و نام خانوادگی<input disabled placeholder="نام کامل"></label>
        <label>نقش سازمانی<input disabled placeholder="بازرس، مدیر یا نماینده"></label>
        <label>شماره تماس<input disabled placeholder="شماره تماس"></label>
        <label>ایمیل<input disabled placeholder="name@example.com"></label>
        <label>تصویر مهر<input type="file" accept="image/*" disabled></label>
        <label>تصویر امضا<input type="file" accept="image/*" disabled></label>
      </div>
      <p class="hint">فیلدهای مهر و امضا برای مشاهده در سامانه نگه داشته شده‌اند؛ در حال حاضر هیچ تصویری بارگذاری یا ذخیره نمی‌شود.</p>
    </article>`
  );
}

async function renderRecord() {
  const rows = await api("/api/inspector/record");
  app.innerHTML = shell(
    "کارنامه بازرسی",
    "بازرسی‌هایی که کارفرما تأیید کرده، با زمان، تاریخ، شرکت و بازهٔ انجام کار.",
    `<article class="card pad">${recordTable(rows)}</article>`
  );
}

async function renderPeople() {
  if (state.me.role === "buyer") {
    const records = await api("/api/company/inspections");
    app.innerHTML = shell(
      "بازرسی‌های انجام‌شده توسط این شرکت",
      "سوابق بازرسی پروژه‌های کارفرما و وضعیت تأیید نهایی",
      `<article class="card pad"><div class="tablewrap"><table><thead><tr><th>گزارش</th><th>پروژه</th><th>تجهیز / نقطه</th><th>بازرس</th><th>نتیجه</th><th>تأیید کارفرما</th><th>تاریخ ثبت</th><th></th></tr></thead><tbody>
        ${records.map((row) => `<tr><td>${esc(row.ivr_no)}</td><td>${esc(row.project)}</td><td>${esc(row.tag)} · ${esc(row.title)}</td><td>${esc(row.inspector)}</td><td>${esc(row.result_label)}${row.client_rejection_note ? `<small>${esc(row.client_rejection_note)}</small>` : ""}</td><td>${row.client_approved ? "تأییدشده" : row.client_rejection_note ? "ردشده" : "در انتظار"}</td><td>${esc(faWhen(row.submitted_at).date)}</td><td><button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">مشاهده</button></td></tr>`).join("") || `<tr><td colspan="8">بازرسی انجام‌شده‌ای برای شرکت ثبت نشده است.</td></tr>`}
      </tbody></table></div></article>`
    );
    return;
  }
  const people = await api("/api/inspectors");
  app.innerHTML = shell(
    "بازرسان",
    "تخصص، موقعیت جغرافیایی، آنلاین بودن و شعاع پوشش. پیام جعفری آفلاین است و نیما حسینی در قزوین از شعاع کارگاه بیرون است.",
    `<table><thead><tr><th>نام</th><th>شهر</th><th>مختصات (عرض، طول)</th><th>وضعیت</th><th>تخصص</th><th>امتیاز</th><th>کار فعال</th></tr></thead><tbody>
      ${people.map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.city)}</td><td dir="ltr">${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}</td><td>${person.online ? "آنلاین" : "آفلاین"}</td><td>${esc(person.discipline_labels.join("، "))}</td><td>${person.rating.toLocaleString("fa-IR")}</td><td>${person.active_jobs.toLocaleString("fa-IR")}</td></tr>`).join("")}
    </tbody></table>`
  );
}

async function renderWallet() {
  const ledger = await api("/api/ledger");
  app.innerHTML = shell(
    "تسویه بازدید",
    "هجده درصد سهم سامانه است. بازدید مردود، تا اصلاح و تأیید دوباره، تسویه نمی‌شود.",
    `<div class="kpis">
      <div class="kpi"><span>بازدید تسویه‌شده</span><strong>${ledger.count.toLocaleString("fa-IR")}</strong></div>
      <div class="kpi"><span>ناخالص</span><strong>${money(ledger.fee_irr)}</strong></div>
      <div class="kpi"><span>سهم سامانه</span><strong>${money(ledger.commission_irr)}</strong></div>
      <div class="kpi"><span>خالص بازرس</span><strong>${money(ledger.net_irr)}</strong></div>
      ${ledger.travel_irr == null ? "" : `<div class="kpi"><span>ایاب‌وذهاب یک‌طرفه (۱٬۲۰۰ تومان/کیلومتر)</span><strong>${money(ledger.travel_irr)}</strong></div>`}
    </div>`
  );
}

function mark(code, legend) {
  return `<span class="mark mark-${esc(code)}">${esc(legend[code] || code)}</span>`;
}

function sourceList(sources) {
  return sources.map((source) => {
    const title = source.url.startsWith("http")
      ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title)}</a>`
      : `<b>${esc(source.title)}</b>`;
    return `<li>${title}<small>${esc(source.used_for)} · ${esc(source.url)}</small></li>`;
  }).join("");
}

async function renderBenchmark() {
  const data = await api("/api/benchmark");
  const head = data.systems.map((system) => `<th>${esc(system.name)}</th>`).join("");
  const rows = data.criteria.map((criterion) => `
    <tr>
      <th>${esc(criterion.label)}</th>
      ${data.systems.map((system) => `<td>${mark(system.scores[criterion.id], data.legend)}</td>`).join("")}
    </tr>`).join("");
  const cards = data.systems.filter((system) => system.id !== "ours").map((system) => `
    <article class="card pad detail">
      <div class="split"><span class="chip">${esc(system.kind)}</span><span class="chip">${esc(system.region)}</span></div>
      <h3>${esc(system.name)}</h3>
      <p>${esc(system.summary)}</p>
      <h3>آنچه منبع می‌گوید</h3>
      <ul>${system.does.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>نزدیک به این نسخه</h3>
      <ul>${system.same.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>جلوتر از این نسخه</h3>
      <ul>${system.ahead_of_us.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>تفاوت این نسخه</h3>
      <ul>${system.we_do.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>منبع</h3>
      <ul class="sources">${sourceList(system.sources)}</ul>
    </article>`).join("");
  const ours = data.systems.find((system) => system.id === "ours");
  app.innerHTML = shell(
    "بنچ‌مارک",
    `مقایسه تا ${data.as_of}. ${data.method}`,
    `<div class="detail">
      <article class="card pad">
        <h3>${esc(ours.name)}</h3>
        <p>${esc(ours.summary)}</p>
        <ul>${ours.does.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
        <ul>${ours.limits.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      </article>
      <div class="tablewrap">
        <table class="matrix">
          <thead><tr><th>معیار</th>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="hint">راهنما: ${Object.entries(data.legend).map(([code, label]) => mark(code, data.legend)).join(" ")}</p>
      ${cards}
      <article class="card pad">
        <h3>${esc(data.institutional.name)}</h3>
        <p>${esc(data.institutional.summary)}</p>
        <ul class="sources">${sourceList(data.institutional.sources)}</ul>
      </article>
    </div>`
  );
}

async function renderTechnology() {
  const data = await api("/api/technology");
  const cards = data.layers.map((layer) => `
    <article class="card pad detail">
      <div class="split">
        <h3>${esc(layer.title)}</h3>
        <span class="chip status-${esc(layer.status)}">${esc(layer.status_label)}</span>
      </div>
      <p>${esc(layer.summary)}</p>
      <table>
        <tbody>
          ${layer.items.map((item) => `<tr><th>${esc(item.name)}</th><td>${esc(item.note)}</td></tr>`).join("")}
        </tbody>
      </table>
    </article>`).join("");
  app.innerHTML = shell(
    "تکنولوژی استفاده‌شده",
    `نسخه ${data.version}. ${data.principle}`,
    `<div class="techgrid">${cards}</div>`
  );
}

async function render() {
  clearTimeout(state.deskTimer);
  if (!state.me) {
    login();
    return;
  }
  if (
    state.me.role === "buyer"
    && ["dispatch", "forms", "benchmark", "technology"].includes(state.view)
    && !(state.view === "forms" && (
      state.requestPointId || state.inRequestMode || state.visitReportId
      || (state.formKind === "in" && state.formId)
    ))
  ) {
    state.view = "desk";
    state.viewHistory = [];
  }
  if (
    state.me.role === "vendor"
    && !["desk", "docs", "notifications", "point"].includes(state.view)
    && !(state.view === "forms" && state.visitReportId)
  ) {
    state.view = "desk";
    state.viewHistory = [];
  }
  const views = {
    desk: renderDesk,
    "buyer-new-in": renderBuyerNewIn,
    "buyer-new-international": renderBuyerNewIn,
    "buyer-in-list": renderBuyerInList,
    "buyer-itp-new": renderBuyerItpNew,
    "buyer-itp-list": renderBuyerItpList,
    "buyer-progress": renderBuyerProgress,
    "buyer-completed": renderBuyerCompleted,
    "buyer-status": renderBuyerStatus,
    "buyer-date": renderBuyerDate,
    "buyer-bills": renderBuyerBills,
    registration: renderRegistration,
    ivr: () => renderIvr(state.visitId),
    dispatch: renderDispatch,
    archive: renderArchive,
    record: renderRecord,
    docs: renderDocs,
    moms: renderMoms,
    forms: renderForms,
    notifications: renderNotifications,
    calendar: renderCalendar,
    people: renderPeople,
    wallet: renderWallet,
    benchmark: renderBenchmark,
    technology: renderTechnology,
    point: renderPoint,
  };
  try {
    await api("/api/dispatch/tick", { method: "POST" });
    await (views[state.view] || renderDesk)();
  } catch (error) {
    app.innerHTML = shell("خطا", "نمایش این صفحه ممکن نشد.", `<article class="card pad">${esc(error.message)}</article>`);
  }
}

async function onClick(event) {
  const requestPanelSummary = event.target.closest(".buyer-request-box > summary");
  if (requestPanelSummary) {
    const panels = [...app.querySelectorAll(".buyer-request-box")];
    const index = panels.indexOf(requestPanelSummary.parentElement);
    if (index >= 0) state.buyerRequestPanels[index] = !panels[index].open;
    return;
  }
  const node = event.target.closest("[data-act]");
  if (!node) return;
  const act = node.dataset.act;
  try {
    if (act === "login") {
      state.me = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: node.dataset.user, password: "demo1234" }) });
      state.viewHistory = [];
      state.view = state.me.role === "inspector" ? "dispatch" : "desk";
      await render();
    } else if (act === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.me = null;
      state.viewHistory = [];
      render();
    } else if (act === "back") {
      goBack();
      await render();
    } else if (act === "cancel-in-form") {
      goBack();
      await render();
    } else if (act === "search-location") {
      const location = document.querySelector("[data-form-key='location']")?.value;
      if (!location) throw new Error("Select an inspection location first.");
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`, "_blank", "noopener,noreferrer");
    } else if (act === "add-form-row" || act === "remove-form-row") {
      const englishForm = state.formSpec?.payload?.customer_location === "international";
      if (!state.formSpec) throw new Error("فرم برای ویرایش آماده نیست.");
      const table = state.formSpec.tables?.find((item) => item.key === node.dataset.table);
      if (!table) throw new Error(englishForm ? "The requested table is unavailable." : "جدول درخواستی در فرم تعریف نشده است.");
      const payload = collectForm();
      const rows = [...(payload[table.key] || [])];
      if (act === "add-form-row") {
        if (rows.length >= 100) throw new Error(englishForm ? "Each table can contain up to 100 rows." : "حداکثر ۱۰۰ ردیف برای هر جدول مجاز است.");
        rows.push(Object.fromEntries(table.columns.map(({ key }) => [key, ""])));
      } else {
        const rowIndex = Number(node.dataset.row);
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
          throw new Error(englishForm ? "The selected row is invalid." : "ردیف انتخاب‌شده معتبر نیست.");
        }
        if (rows.length <= 1) {
          rows[0] = Object.fromEntries(table.columns.map(({ key }) => [key, ""]));
        } else {
          rows.splice(rowIndex, 1);
        }
      }
      state.formDraft = { ...payload, [table.key]: rows };
      await render();
    } else if (act === "open-form") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.inRequestMode = false;
      state.visitReportId = null;
      state.formKind = node.dataset.kind || "itp";
      state.formId = null;
      state.formDraft = null;
      state.requestPointId = null;
      state.requestPrefill = null;
      navigateTo("forms");
      await render();
    } else if (act === "open-visit-report-form") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.inRequestMode = false;
      state.visitReportId = Number(node.dataset.id);
      state.formId = null;
      state.formDraft = null;
      state.requestPointId = null;
      state.requestPrefill = null;
      navigateTo("forms");
      await render();
    } else if (act === "form-kind") {
      state.formKind = node.dataset.kind;
      state.formId = null;
      state.formDraft = null;
      navigateTo("forms");
      await render();
    } else if (act === "new-form") {
      state.formId = null;
      state.formDraft = null;
      await render();
    } else if (act === "open-sheet") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.inRequestMode = false;
      state.visitReportId = null;
      state.formId = Number(node.dataset.id);
      state.formKind = node.dataset.kind || state.formKind;
      state.formDraft = null;
      state.requestPointId = null;
      state.requestPrefill = null;
      navigateTo("forms");
      await render();
    } else if (act === "choose-in-location") {
      state.requestCustomerLocation = node.dataset.location === "international" ? "international" : "iran";
      await render();
    } else if (act === "begin-in-request") {
      state.formReturnView = state.view;
      state.inRequestMode = true;
      state.formKind = "in";
      state.requestCustomerLocation = node.dataset.location === "international" ? "international" : "iran";
      state.formId = null;
      state.formDraft = null;
      const requestBoard = await api(`/api/board?kind=${state.kind === "case" ? "case" : "project"}`);
      state.requestPoints = requestBoard.filter((row) =>
        ["draft", "documents_missing", "returned"].includes(row.request_status)
      );
      const firstEligiblePoint = state.requestPoints[0];
      if (!firstEligiblePoint) throw new Error("نقطه‌ای برای ثبت درخواست IN موجود نیست.");
      state.pointId = Number(firstEligiblePoint.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.requestPointId = state.pointId;
      state.requestPrefill = prefillInspectionRequestForLocation(detail, state.requestCustomerLocation);
      navigateTo("forms");
      await render();
    } else if (act === "open-request-form") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.pointId = Number(node.dataset.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.inRequestMode = true;
      state.requestPointId = state.pointId;
      state.requestPoints = [];
      state.requestCustomerLocation = node.dataset.location === "international"
        ? "international"
        : state.requestCustomerLocation || "iran";
      state.requestPrefill = prefillInspectionRequestForLocation(detail, state.requestCustomerLocation);
      state.formKind = "in";
      state.formId = null;
      state.formDraft = null;
      navigateTo("forms");
      await render();
    } else if (act === "select-in-point") {
      if (state.requestPointId) {
        state.formDraft = collectForm();
        ["client", "project", "po", "contractor", "vendor", "manufacturer", "location", "tag", "itp_item", "discipline", "reference"].forEach((key) => {
          delete state.formDraft[key];
        });
      }
      state.pointId = Number(node.dataset.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.inRequestMode = true;
      state.requestPointId = state.pointId;
      state.requestPrefill = {
        ...prefillInspectionRequestForLocation(detail, state.requestCustomerLocation || "iran"),
      };
      state.formKind = "in";
      state.formId = null;
      navigateTo("forms");
      await render();
    } else if (act === "approve-request-manager") {
      const unitManagerId = Number(document.querySelector("#request-unit-manager")?.value);
      if (!unitManagerId) throw new Error("مدیر واحد را انتخاب کنید.");
      const signature = document.querySelector("#request-manager-signature")?.files[0];
      if (!signature) throw new Error("تصویر مهر و امضای مدیر پروژه را بارگذاری کنید.");
      const form = new FormData();
      form.append("unit_manager_id", String(unitManagerId));
      form.append("department", document.querySelector("#request-department")?.value || "");
      form.append("note", document.querySelector("#request-manager-note")?.value || "");
      form.append("file", signature);
      const result = await api(`/api/points/${node.dataset.id}/manager-approval`, {
        method: "POST",
        body: form,
      });
      toast(result.request_status === "documents_missing" ? result.message : "درخواست برای مدیر واحد ارسال شد");
      await render();
    } else if (act === "approve-request-unit") {
      const signature = document.querySelector(`#request-unit-signature-${node.dataset.id}`)?.files[0];
      if (!signature) throw new Error("تصویر مهر و امضای مدیر واحد را بارگذاری کنید.");
      const form = new FormData();
      form.append("note", "");
      form.append("file", signature);
      const result = await api(`/api/points/${node.dataset.id}/unit-approval`, {
        method: "POST",
        body: form,
      });
      toast(result.request_status === "approved_no_inspector" ? result.message : `${result.offers} پیشنهاد برای بازرسان نزدیک ارسال شد`);
      await render();
    } else if (act === "return-request") {
      const reasonInput = document.querySelector("#request-return-reason");
      const reason = reasonInput?.value || window.prompt("دلیل مرجوعی را وارد کنید:") || "";
      if (reason.trim().length < 3) throw new Error("دلیل مرجوعی حداقل باید ۳ نویسه باشد.");
      const result = await api(`/api/points/${node.dataset.id}/return`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast(`درخواست به مرحله قبل برگشت: ${result.request_status}`);
      await render();
    } else if (act === "send-request-comment") {
      const body = document.querySelector("#request-comment-body")?.value || "";
      await api(`/api/points/${node.dataset.id}/request-comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      toast("نظر به گفتگو اضافه شد");
      await renderPoint();
    } else if (act === "manager-tab") {
      state.managerTab = node.dataset.tab;
      await render();
    } else if (act === "calendar-prev" || act === "calendar-next") {
      state.calendarOffset += act === "calendar-next" ? 1 : -1;
      await render();
    } else if (act === "convert-date") {
      const input = document.querySelector("#buyer-date-input");
      if (!input?.value) throw new Error("تاریخ میلادی را انتخاب کنید.");
      const converted = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        dateStyle: "long",
        timeZone: "Asia/Tehran",
      }).format(new Date(`${input.value}T12:00:00`));
      const result = document.querySelector("#buyer-date-result");
      if (result) result.textContent = `تاریخ شمسی: ${converted}`;
      return;
    } else if (act === "approve-request-executive") {
      const result = await api(`/api/points/${node.dataset.id}/executive-approval`, {
        method: "POST",
        body: JSON.stringify({ note: "" }),
      });
      toast(result.request_status === "approved_no_inspector" ? result.message : `${result.offers} پیشنهاد برای بازرسان نزدیک ارسال شد`);
      await render();
    } else if (act === "send-comment") {
      const visitId = Number(node.dataset.id);
      const body = document.querySelector("#report-comment").value;
      await api(`/api/visits/${visitId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      toast("نظر به اعضای کارتابل گزارش ارسال شد");
      await renderIvr(visitId);
    } else if (act === "upload-visit-attachment") {
      const file = document.querySelector("#visit-attachment").files[0];
      if (!file) throw new Error("ابتدا فایل را انتخاب کنید.");
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "item");
      form.append("caption", file.name);
      await api(`/api/visits/${node.dataset.id}/attachments`, { method: "POST", body: form });
      toast("پیوست گزارش بارگذاری شد");
      await renderIvr(Number(node.dataset.id));
    } else if (act === "print-form") {
      window.print();
    } else if (act === "save-form") {
      const payload = collectForm();
      if (state.requestPointId) {
        const result = await api(`/api/points/${state.requestPointId}/request`, {
          method: "POST",
          body: JSON.stringify({
            in_payload: payload,
            remote_requested: Boolean(document.querySelector("#request-remote")?.checked),
            note: payload.observation || "",
          }),
        });
        state.pointId = state.requestPointId;
        state.requestPointId = null;
        state.inRequestMode = false;
        state.requestPrefill = null;
        state.requestCustomerLocation = null;
        state.requestPoints = [];
        state.formDraft = null;
        state.view = "point";
        toast(result.request_status === "documents_missing" ? result.message : "درخواست IN برای مدیر پروژه ارسال شد");
        await render();
      } else {
        const saved = await api("/api/forms", {
          method: "POST",
          body: JSON.stringify({ kind: state.formKind, sheet_id: state.formId, payload }),
        });
        state.formId = saved.id;
        state.formDraft = null;
        toast("فرم ثبت شد");
        await render();
      }
    } else if (act === "save-visit-report-form") {
      const saved = await api(`/api/visits/${state.visitReportId}/in-report-form`, {
        method: "PUT",
        body: JSON.stringify({ payload: collectForm() }),
      });
      const returnView = state.formReturnView || "dispatch";
      state.visitReportId = null;
      state.formDraft = null;
      toast(saved.completed ? "نسخهٔ گزارش فرم IN ذخیره شد؛ فرم اصلی کارفرما بدون تغییر ماند" : "فرم گزارش ذخیره شد");
      navigateTo(returnView);
      await render();
    } else if (act === "kind") {
      state.kind = node.dataset.kind === "case" ? "case" : "project";
      navigateTo("desk");
      await render();
    } else if (act === "goto") {
      if (node.dataset.view === "forms" && state.view !== "forms") state.formReturnView = state.view;
      if (node.dataset.view === "buyer-new-international") state.requestCustomerLocation = "international";
      if (node.dataset.view === "buyer-new-in") state.requestCustomerLocation = null;
      navigateTo(node.dataset.view);
      await render();
    } else if (act === "open-point") {
      state.pointId = node.dataset.id;
      navigateTo("point");
      await render();
    } else if (act === "open-ivr") {
      state.visitId = Number(node.dataset.id);
      navigateTo("ivr");
      await render();
    } else if (act === "print-archive") {
      window.print();
    } else if (act === "upload-document") {
      const file = document.querySelector("#document-file").files[0];
      if (!file) throw new Error("ابتدا فایل مدرک را انتخاب کنید.");
      const body = new FormData();
      body.append("equipment_id", document.querySelector("#document-equipment").value);
      body.append("doc_type", document.querySelector("#document-type").value);
      body.append("file", file);
      await api("/api/documents/upload", { method: "POST", body });
      toast("فایل مدرک بارگذاری و ثبت شد");
      await render();
    } else if (act === "ready") {
      await api(`/api/points/${node.dataset.id}/ready`, { method: "POST", body: JSON.stringify({ remote_requested: node.dataset.remote === "1", window_note: "اعلام از میز سازنده" }) });
      toast("آمادگی ثبت شد");
      await render();
    } else if (act === "broadcast") {
      await api(`/api/points/${node.dataset.id}/broadcast`, { method: "POST" });
      toast("پیشنهاد برای بازرسان نزدیک ارسال شد");
      await render();
    } else if (act === "accept") {
      await api(`/api/offers/${node.dataset.id}/accept`, { method: "POST" });
      toast("بازدید برای شما قفل شد");
      await render();
    } else if (act === "decline") {
      await api(`/api/offers/${node.dataset.id}/decline`, { method: "POST" });
      toast("پیشنهاد رد شد");
      await render();
    } else if (act === "enroute") {
      await api(`/api/visits/${node.dataset.id}/en-route`, { method: "POST" });
      await render();
    } else if (act === "remote") {
      await api(`/api/visits/${node.dataset.id}/remote`, { method: "POST" });
      toast("بازبینی شروع شد؛ برای ثبت گزارش، موقعیت را تأیید کنید");
      await render();
    } else if (act === "confirm-location") {
      const location = await currentLocation();
      await api(`/api/visits/${node.dataset.id}/location`, { method: "POST", body: JSON.stringify(location) });
      toast("موقعیت جغرافیایی تأیید شد؛ پیوست گزارش فعال است");
      await render();
    } else if (act === "arrive") {
      const location = await currentLocation();
      await api(`/api/visits/${node.dataset.id}/arrive`, { method: "POST", body: JSON.stringify(location) });
      toast("حضور در محدوده کارگاه ثبت شد");
      await render();
    } else if (act === "submit-visit") {
      const active = await api("/api/visits/active");
      if (active.visit.report_form_completed === false && active.context.point.request_form_id) {
        throw new Error("ابتدا نسخهٔ گزارش فرم IN را با مدت و شرح بازرسی تکمیل و ذخیره کنید.");
      }
      if (!active.visit.signature_uploaded) {
        const signature = document.querySelector("#inspector-report-signature")?.files[0];
        if (!signature) throw new Error("برای ارسال گزارش، مهر و امضای تصویری بازرس را بارگذاری کنید.");
        const form = new FormData();
        form.append("file", signature);
        form.append("kind", "inspector_signature");
        form.append("caption", "مهر و امضای بازرس برای ارسال گزارش");
        await api(`/api/visits/${node.dataset.id}/attachments`, { method: "POST", body: form });
      }
      const answers = active.context.point.checklist.map((item) => ({
        item_id: item.id,
        value: state.draft[item.id] || "pass",
        note: (state.draft[item.id] || "pass") === "fail" ? "خارج از معیار پذیرش کارگاهی" : "",
      }));
      await api(`/api/visits/${node.dataset.id}/checklist`, { method: "POST", body: JSON.stringify({ answers }) });
      const note = node.dataset.result === "reject" ? "بازدید مردود شد و نیاز به تعمیر دارد." : "بازدید مطابق ITP قابل قبول است و شواهد پیوست شد.";
      await api(`/api/visits/${node.dataset.id}/submit`, { method: "POST", body: JSON.stringify({ result: node.dataset.result, note }) });
      toast("IVR ارسال شد");
      navigateTo("desk");
      await render();
    } else if (act === "review") {
      let note = document.querySelector(`#review-note-${node.dataset.id}`)?.value || "";
      if (node.dataset.decision === "return" && note.trim().length < 3) {
        note = window.prompt("دلیل مرجوعی گزارش را وارد کنید:") || "";
      }
      if (node.dataset.decision === "return" && note.trim().length < 3) {
        throw new Error("برای مرجوع کردن گزارش، دلیل حداقل سه نویسه‌ای لازم است.");
      }
      const result = await api(`/api/visits/${node.dataset.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: node.dataset.decision, note }),
      });
      toast(node.dataset.decision === "return"
        ? (result.visit.report_stage === "inspector_revision" ? "برای اصلاح به بازرس برگشت" : "برای بررسی دوباره به مرحله قبل برگشت")
        : (result.visit.report_stage === "manager_review" ? "تأیید شد و به مدیر پروژه رفت" : "تأیید شد و به کارفرما رفت"));
      await render();
    } else if (act === "confirm-report") {
      await api(`/api/visits/${node.dataset.id}/confirm`, { method: "POST" });
      toast("تأیید نهایی ثبت شد و صورت‌وضعیت و فاکتور برای کارفرما صادر شد");
      await render();
    } else if (act === "client-reject-report") {
      const reason = document.querySelector(`#client-reject-note-${node.dataset.id}`)?.value || "";
      await api(`/api/visits/${node.dataset.id}/client-reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast("گزارش با دلیل ثبت‌شده رد و برای اصلاح برگشت");
      await render();
    } else if (act === "update-bill-status") {
      const billId = Number(node.dataset.id);
      const status = document.querySelector(`#bill-status-${billId}`).value;
      const note = document.querySelector(`#bill-note-${billId}`).value;
      await api(`/api/bills/${billId}/accounting-status`, {
        method: "POST",
        body: JSON.stringify({ status, note }),
      });
      toast("وضعیت صورت‌وضعیت ثبت شد");
      await render();
    } else if (act === "update-claim-status") {
      const billId = Number(node.dataset.id);
      const status = document.querySelector(`#claim-status-${billId}`).value;
      const note = document.querySelector(`#claim-note-${billId}`).value;
      await api(`/api/bills/${billId}/claim-status`, {
        method: "POST",
        body: JSON.stringify({ status, note }),
      });
      toast("وضعیت Claim ثبت شد");
      await render();
    } else if (act === "save-mom") {
      await api("/api/moms", {
        method: "POST",
        body: JSON.stringify({
          title: document.querySelector("#mom-title").value,
          held_on: document.querySelector("#mom-date").value,
          attendees: document.querySelector("#mom-people").value,
          body: document.querySelector("#mom-body").value,
        }),
      });
      toast("صورتجلسه ثبت شد");
      await render();
    }
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || state.view !== "forms") return;
  event.preventDefault();
  goBack();
  render();
});

app.addEventListener("click", onClick);
app.addEventListener("submit", async (event) => {
  if (event.target.id !== "login-form") return;
  event.preventDefault();
  try {
    await loginWithCredentials();
  } catch (error) {
    toast(error.message);
  }
});
app.addEventListener("input", (event) => {
  const search = event.target.closest("[data-in-search]");
  if (search) filterInRegistry(search.closest(".in-registry"));
  const progressSearch = event.target.closest("[data-buyer-progress-search]");
  if (progressSearch) {
    const query = progressSearch.value.trim().toLocaleLowerCase("fa-IR");
    app.querySelectorAll("[data-buyer-progress-row]").forEach((row) => {
      row.hidden = !row.dataset.search.includes(query);
    });
  }
});
app.addEventListener("change", async (event) => {
  const registryFilter = event.target.closest("[data-in-filter]");
  if (registryFilter) {
    filterInRegistry(registryFilter.closest(".in-registry"));
    return;
  }
  const requestPoint = event.target.closest("[data-buyer-in-point]");
  if (requestPoint) {
    try {
      const currentPayload = collectForm();
      const pointId = Number(requestPoint.value);
      if (!Number.isInteger(pointId) || !state.requestPoints.some((point) => Number(point.id) === pointId)) {
        throw new Error("Please select a valid inspection point.");
      }
      const detail = await api(`/api/points/${pointId}`);
      const prefill = prefillInspectionRequestForLocation(detail, "international");
      state.pointId = pointId;
      state.requestPointId = pointId;
      state.requestPrefill = prefill;
      state.formDraft = { ...currentPayload, ...prefill, location: currentPayload.location || prefill.location };
      await renderForms();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const formLocation = event.target.closest("[data-form-key='customer_location']");
  if (formLocation) {
    state.formDraft = collectForm();
    await renderForms();
    return;
  }
  const node = event.target.closest("[data-act='answer']");
  if (node) {
    state.draft[node.dataset.item] = node.value;
    return;
  }
  const photo = event.target.closest("[data-act='pick-photo']");
  if (!photo || !photo.files || !photo.files[0]) return;
  const place = await new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4000 },
    );
  });
  const body = new FormData();
  body.append("kind", photo.dataset.kind);
  body.append("file", photo.files[0]);
  if (place) {
    body.append("lat", String(place.lat));
    body.append("lng", String(place.lng));
  }
  try {
    await api(`/api/visits/${photo.dataset.id}/photo`, { method: "POST", body });
    toast("عکس روی موبایل ثبت شد");
  } catch (error) {
    toast(error.message);
  }
});

boot();
