import { useEffect, useMemo, useState } from "react";

const API_BASE = "/api";
const tabs = [
  { id: "fees", label: "Fees Management" },
  { id: "registration", label: "Student Registration" },
  { id: "completed", label: "Completed List" },
  { id: "pending", label: "Pending List" }
];

const monthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const initialLogin = { username: "", password: "" };
const initialStudent = { name: "", className: "", batchYear: "", phoneNumber: "", joinDate: "" };
const initialFilter = { batchYear: "", className: "", search: "", monthNumber: "" };
const initialAdminAccessForm = { username: "", password: "" };
const initialAdminSettingsForm = {
  currentUsername: "",
  currentPassword: "",
  nextUsername: "",
  nextPassword: "",
  confirmPassword: "",
  currentYearFee: ""
};

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || "Request failed");
  }

  return response.json();
}

function getFeeSummary(student) {
  const paidCount = student.fees.filter((fee) => fee.remainingAmount === 0).length;
  const pendingCount = student.fees.filter((fee) => fee.remainingAmount > 0).length;
  const remainingTotal = student.fees.reduce(
    (sum, fee) => sum + Number(fee.remainingAmount || 0),
    0
  );

  return `${paidCount}/12 months completed | Pending: ${pendingCount} | Remaining: ${formatAmount(
    remainingTotal
  )}`;
}

function formatAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function getStudentPendingSummary(student, monthNumber) {
  if (monthNumber) {
    const fee = student.fees.find((entry) => entry.monthNumber === monthNumber);

    if (!fee) {
      return "No month data";
    }

    return fee.remainingAmount === 0
      ? "Fully paid"
      : `Remaining ${formatAmount(fee.remainingAmount)}`;
  }

  const pendingCount = student.fees.filter((fee) => fee.remainingAmount > 0).length;
  const totalRemaining = student.fees.reduce(
    (sum, fee) => sum + Number(fee.remainingAmount || 0),
    0
  );

  return `${pendingCount} months pending | Remaining ${formatAmount(totalRemaining)}`;
}

function hasActiveFilter(filter) {
  return Boolean(filter.batchYear || filter.className || filter.search.trim());
}

function hasBatchAndClassFilter(filter) {
  return Boolean(filter.batchYear && filter.className);
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState(initialLogin);
  const [loginError, setLoginError] = useState("");
  const [activeTab, setActiveTab] = useState("fees");
  const [studentForm, setStudentForm] = useState(initialStudent);
  const [students, setStudents] = useState([]);
  const [options, setOptions] = useState({ batchYears: [], classes: [] });
  const [filter, setFilter] = useState(initialFilter);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [detailMode, setDetailMode] = useState("view");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [adminAccessForm, setAdminAccessForm] = useState(initialAdminAccessForm);
  const [adminSettingsForm, setAdminSettingsForm] = useState(initialAdminSettingsForm);
  const [adminAccessError, setAdminAccessError] = useState("");
  const [adminSettingsError, setAdminSettingsError] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [isAdminSaving, setIsAdminSaving] = useState(false);
  const [currentYearFeeInfo, setCurrentYearFeeInfo] = useState({ currentYear: "", currentYearFee: "" });
  const [adminAccessFormKey, setAdminAccessFormKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoginForm(initialLogin);
      setLoginError("");
      return;
    }

    loadOptions();
    loadStudents("fees", filter);
    loadAdminSettings();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage("");
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  async function loadOptions() {
    const data = await apiFetch("/options");
    setOptions(data);
  }

  async function loadAdminSettings() {
    const data = await apiFetch("/admin/settings");
    setCurrentYearFeeInfo(data);
  }

  async function loadStudents(tabId, currentFilter) {
    const needsBaseFilter = tabId === "fees";
    const needsBatchAndClass = tabId === "completed" || tabId === "pending";

    if (needsBaseFilter && !hasActiveFilter(currentFilter)) {
      setStudents([]);
      return;
    }

    if (needsBatchAndClass && !hasBatchAndClassFilter(currentFilter)) {
      setStudents([]);
      return;
    }

    const query = new URLSearchParams();

    if (currentFilter.batchYear) {
      query.set("batchYear", currentFilter.batchYear);
    }

    if (currentFilter.className) {
      query.set("className", currentFilter.className);
    }

    if (currentFilter.search) {
      query.set("search", currentFilter.search);
    }

    if (tabId === "completed") {
      query.set("status", "completed");
    }

    if (tabId === "pending") {
      query.set("status", "pending");
    }

    if (
      (tabId === "completed" || tabId === "pending") &&
      currentFilter.monthNumber
    ) {
      query.set("monthNumber", currentFilter.monthNumber);
    }

    const data = await apiFetch(`/students?${query.toString()}`);
    setStudents(data);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");

    try {
      await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      setIsAuthenticated(true);
    } catch (error) {
      setLoginError(error.message);
    }
  }

  async function handleRegisterStudent(event) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");

    try {
      const createdStudent = await apiFetch("/students", {
        method: "POST",
        body: JSON.stringify(studentForm)
      });

      setStudentForm(initialStudent);
      setMessage("Student registered successfully.");
      await loadOptions();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTabChange(tabId) {
    setActiveTab(tabId);
    setSelectedStudent(null);
    await loadStudents(tabId, filter);
  }

  async function handleFilterChange(nextFilter) {
    setFilter(nextFilter);
    await loadStudents(activeTab, nextFilter);
  }

  async function openStudent(studentId) {
    const data = await apiFetch(`/students/${studentId}`);
    setSelectedStudent(data);
    setDetailMode("view");
  }

  async function saveStudentDetails() {
    if (!selectedStudent) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const updated = await apiFetch(`/students/${selectedStudent.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: selectedStudent.name,
          className: selectedStudent.className,
          batchYear: selectedStudent.batchYear,
          phoneNumber: selectedStudent.phoneNumber,
          joinDate: selectedStudent.joinDate
        })
      });

      setSelectedStudent(updated);
      setDetailMode("view");
      setMessage("Student details updated.");
      await loadOptions();
      await loadStudents(activeTab, filter);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveFees() {
    if (!selectedStudent) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const updated = await apiFetch(`/students/${selectedStudent.id}/fees`, {
        method: "PUT",
        body: JSON.stringify({
          fees: selectedStudent.fees
        })
      });

      setSelectedStudent(updated);
      setMessage("Fee details updated.");
      await loadStudents(activeTab, filter);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteStudent() {
    if (!selectedStudent) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete student "${selectedStudent.name}"? This cannot be undone.`
    );

    if (!shouldDelete) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await apiFetch(`/students/${selectedStudent.id}`, {
        method: "DELETE"
      });

      setSelectedStudent(null);
      setDetailMode("view");
      setMessage("Student deleted successfully.");
      await loadOptions();
      await loadStudents(activeTab, filter);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdminAccess(event) {
    event.preventDefault();
    setAdminAccessError("");
    setAdminSettingsError("");
    setIsAdminSaving(true);

    try {
      const data = await apiFetch("/admin/access", {
        method: "POST",
        body: JSON.stringify(adminAccessForm)
      });

      setHasAdminAccess(true);
      setCurrentYearFeeInfo({
        currentYear: data.currentYear,
        currentYearFee: data.currentYearFee
      });
      setAdminSettingsForm({
        currentUsername: adminAccessForm.username,
        currentPassword: adminAccessForm.password,
        nextUsername: "",
        nextPassword: "",
        confirmPassword: "",
        currentYearFee: data.currentYearFee || ""
      });
      setAdminAccessForm(initialAdminAccessForm);
    } catch (error) {
      setAdminAccessError(error.message);
    } finally {
      setIsAdminSaving(false);
    }
  }

  async function handleAdminSettingsSave(event) {
    event.preventDefault();
    setAdminSettingsError("");
    setMessage("");
    setIsAdminSaving(true);

    try {
      const data = await apiFetch("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(adminSettingsForm)
      });

      setCurrentYearFeeInfo({
        currentYear: data.currentYear,
        currentYearFee: data.currentYearFee
      });
      setMessage("Admin settings updated successfully.");
      setHasAdminAccess(false);
      setShowAdminPanel(false);
      setAdminAccessForm(initialAdminAccessForm);
      setAdminSettingsForm(initialAdminSettingsForm);
      setLoginForm(initialLogin);
    } catch (error) {
      setAdminSettingsError(error.message);
    } finally {
      setIsAdminSaving(false);
    }
  }

  const listTitle = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTab);
    return tab ? tab.label : "Students";
  }, [activeTab]);

  const shouldShowStudents =
    activeTab === "fees" ? hasActiveFilter(filter) : hasBatchAndClassFilter(filter);
  const selectedMonthNumber = Number.parseInt(filter.monthNumber, 10);
  const listRibbon = useMemo(() => {
    if (activeTab === "pending") {
      const totalRemaining = students.reduce(
        (sum, student) =>
          sum +
          student.fees.reduce((studentSum, fee) => {
            if (
              Number.isInteger(selectedMonthNumber) &&
              selectedMonthNumber >= 1 &&
              selectedMonthNumber <= 12
            ) {
              return fee.monthNumber === selectedMonthNumber
                ? studentSum + Number(fee.remainingAmount || 0)
                : studentSum;
            }

            return studentSum + Number(fee.remainingAmount || 0);
          }, 0),
        0
      );

      const label =
        Number.isInteger(selectedMonthNumber) &&
        selectedMonthNumber >= 1 &&
        selectedMonthNumber <= 12
          ? `${monthLabels[selectedMonthNumber - 1]} pending`
          : "All pending dues";

      return `${label}: ${students.length} students | Remaining ${formatAmount(totalRemaining)}`;
    }

    if (activeTab === "completed") {
      const totalCollected = students.reduce(
        (sum, student) =>
          sum +
          student.fees.reduce((studentSum, fee) => {
            if (
              Number.isInteger(selectedMonthNumber) &&
              selectedMonthNumber >= 1 &&
              selectedMonthNumber <= 12
            ) {
              return fee.monthNumber === selectedMonthNumber
                ? studentSum + Number(fee.paidAmount || 0)
                : studentSum;
            }

            return studentSum + Number(fee.paidAmount || 0);
          }, 0),
        0
      );

      const label =
        Number.isInteger(selectedMonthNumber) &&
        selectedMonthNumber >= 1 &&
        selectedMonthNumber <= 12
          ? `${monthLabels[selectedMonthNumber - 1]} completed`
          : "Fully completed students";

      return `${label}: ${students.length} students | Collected ${formatAmount(totalCollected)}`;
    }

    return "";
  }, [activeTab, selectedMonthNumber, students]);

  if (!isAuthenticated) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <span className="eyebrow">Tuition Fees Manager</span>
          <h1>Admin Login</h1>
          <p>Use the admin account to manage students, batches, and monthly fee status.</p>
          <form className="login-form" onSubmit={handleLogin} autoComplete="off">
            <label>
              Username
              <input
                type="text"
                name="login-username"
                autoComplete="off"
                value={loginForm.username}
                onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="login-password"
                autoComplete="new-password"
                value={loginForm.password}
                onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
              />
            </label>
            {loginError ? <div className="error-banner">{loginError}</div> : null}
            <button type="submit">Login</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Tuition Fees Manager</span>
          <h1>Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <div className="topbar-note-block">
            <div className="topbar-note">Fees Structure</div>
            <div className="topbar-subnote">
              {currentYearFeeInfo.currentYear
                ? `${currentYearFeeInfo.currentYear} Tuition Fee: ${
                    currentYearFeeInfo.currentYearFee || "Not set"
                  }`
                : "Current year tuition fee not loaded"}
            </div>
            <button
              type="button"
              className="secondary-btn admin-access-btn"
              onClick={() => {
                setShowAdminPanel(!showAdminPanel);
                setHasAdminAccess(false);
                setAdminAccessError("");
                setAdminSettingsError("");
                setAdminAccessForm(initialAdminAccessForm);
                setAdminSettingsForm(initialAdminSettingsForm);
                setAdminAccessFormKey((currentKey) => currentKey + 1);
              }}
            >
              Admin Access
            </button>
          </div>
        </div>
      </header>

      {showAdminPanel ? (
        <section className="panel admin-panel">
          {!hasAdminAccess ? (
            <form
              key={adminAccessFormKey}
              className="login-form"
              onSubmit={handleAdminAccess}
              autoComplete="off"
            >
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Admin Access</span>
                  <h2>Verify Admin Login</h2>
                </div>
              </div>
              <label>
                Username
                <input
                  type="text"
                  name={`admin-access-user-${adminAccessFormKey}`}
                  autoComplete="off"
                  value={adminAccessForm.username}
                  onChange={(event) =>
                    setAdminAccessForm({ ...adminAccessForm, username: event.target.value })
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name={`admin-access-password-${adminAccessFormKey}`}
                  autoComplete="new-password"
                  value={adminAccessForm.password}
                  onChange={(event) =>
                    setAdminAccessForm({ ...adminAccessForm, password: event.target.value })
                  }
                />
              </label>
              {adminAccessError ? <div className="error-banner">{adminAccessError}</div> : null}
              <button type="submit" disabled={isAdminSaving}>
                {isAdminSaving ? "Checking..." : "Verify Admin Access"}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleAdminSettingsSave}>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Admin Settings</span>
                  <h2>Update Access And Fees</h2>
                </div>
              </div>
              <label>
                New Username
                <input
                  type="text"
                  placeholder="Leave empty to keep current username"
                  value={adminSettingsForm.nextUsername}
                  onChange={(event) =>
                    setAdminSettingsForm({ ...adminSettingsForm, nextUsername: event.target.value })
                  }
                />
              </label>
              <label>
                New Password
                <input
                  type="password"
                  placeholder="Leave empty to keep current password"
                  value={adminSettingsForm.nextPassword}
                  onChange={(event) =>
                    setAdminSettingsForm({ ...adminSettingsForm, nextPassword: event.target.value })
                  }
                />
              </label>
              <label>
                Confirm Password
                <input
                  type="password"
                  placeholder="Fill only when changing password"
                  value={adminSettingsForm.confirmPassword}
                  onChange={(event) =>
                    setAdminSettingsForm({
                      ...adminSettingsForm,
                      confirmPassword: event.target.value
                    })
                  }
                />
              </label>
              <label>
                {currentYearFeeInfo.currentYear || new Date().getFullYear()} Tuition Fee
                <input
                  type="text"
                  value={adminSettingsForm.currentYearFee}
                  onChange={(event) =>
                    setAdminSettingsForm({
                      ...adminSettingsForm,
                      currentYearFee: event.target.value
                    })
                  }
                />
              </label>
              {adminSettingsError ? (
                <div className="error-banner">{adminSettingsError}</div>
              ) : null}
              <button type="submit" disabled={isAdminSaving}>
                {isAdminSaving ? "Saving..." : "Save Admin Settings"}
              </button>
            </form>
          )}
        </section>
      ) : null}

      <nav className="tab-strip">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "tab active" : "tab"}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {message ? <div className="message-banner">{message}</div> : null}

      <main className="dashboard-grid">
        <section className="panel panel-main">
          {activeTab === "registration" ? (
            <div>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">New Student</span>
                  <h2>Student Registration</h2>
                </div>
              </div>

              <form className="student-form" onSubmit={handleRegisterStudent}>
                <label>
                  Batch Year
                  <input
                    type="text"
                    placeholder="2026"
                    value={studentForm.batchYear}
                    onChange={(event) =>
                      setStudentForm({ ...studentForm, batchYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  Student Name
                  <input
                    type="text"
                    placeholder="Enter student name"
                    value={studentForm.name}
                    onChange={(event) =>
                      setStudentForm({ ...studentForm, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Class
                  <input
                    type="text"
                    placeholder="8th Standard"
                    value={studentForm.className}
                    onChange={(event) =>
                      setStudentForm({ ...studentForm, className: event.target.value })
                    }
                  />
                </label>
                <label>
                  Phone Number
                  <input
                    type="tel"
                    placeholder="Enter phone number"
                    value={studentForm.phoneNumber}
                    onChange={(event) =>
                      setStudentForm({ ...studentForm, phoneNumber: event.target.value })
                    }
                  />
                </label>
                <label>
                  Join Date
                  <input
                    type="date"
                    value={studentForm.joinDate}
                    onChange={(event) =>
                      setStudentForm({ ...studentForm, joinDate: event.target.value })
                    }
                  />
                </label>
                <button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Add Student"}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Browse Students</span>
                  <h2>{listTitle}</h2>
                </div>
              </div>

              <div className="filter-bar">
                <label className="search-field">
                  Search Student
                  <input
                    type="text"
                    placeholder="Search by student name"
                    value={filter.search}
                    onChange={(event) =>
                      handleFilterChange({ ...filter, search: event.target.value })
                    }
                  />
                </label>
                <label>
                  Batch Year
                  <select
                    value={filter.batchYear}
                    onChange={(event) =>
                      handleFilterChange({ ...filter, batchYear: event.target.value })
                    }
                  >
                    <option value="">All batches</option>
                    {options.batchYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Class
                  <select
                    value={filter.className}
                    onChange={(event) =>
                      handleFilterChange({ ...filter, className: event.target.value })
                    }
                  >
                    <option value="">All classes</option>
                    {options.classes.map((className) => (
                      <option key={className} value={className}>
                        {className}
                      </option>
                    ))}
                  </select>
                </label>
                {activeTab === "completed" || activeTab === "pending" ? (
                  <label>
                    Month
                    <select
                      value={filter.monthNumber}
                      onChange={(event) =>
                        handleFilterChange({ ...filter, monthNumber: event.target.value })
                      }
                    >
                      <option value="">All months</option>
                      {monthLabels.map((monthLabel, index) => (
                        <option key={monthLabel} value={String(index + 1)}>
                          {monthLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="student-list">
                {listRibbon && shouldShowStudents ? (
                  <div className="summary-ribbon">{listRibbon}</div>
                ) : null}
                {!shouldShowStudents ? (
                  <div className="empty-state">
                    {activeTab === "fees"
                      ? "Search a student or select a batch/class to show the student list."
                      : "Select both batch and class to show the student list."}
                  </div>
                ) : students.length === 0 ? (
                  <div className="empty-state">
                    No students found for the selected batch, class, or search text.
                  </div>
                ) : (
                  students.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      className="student-card"
                      onClick={() => openStudent(student.id)}
                    >
                      <div>
                        <h3>{student.name}</h3>
                        <p>
                          {student.className} | Batch {student.batchYear}
                        </p>
                        <p>
                          Phone: {student.phoneNumber || "Not set"}
                        </p>
                        <p>
                          Joined: {student.joinDate || "Not set"}
                        </p>
                      </div>
                      <span>
                        {activeTab === "pending" || activeTab === "completed"
                          ? getStudentPendingSummary(
                              student,
                              Number.isInteger(selectedMonthNumber) ? selectedMonthNumber : null
                            )
                          : getFeeSummary(student)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {activeTab !== "registration" ? (
          <aside className="panel panel-side">
            {selectedStudent ? (
              <div className="student-detail">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">Student Details</span>
                    <h2>{selectedStudent.name}</h2>
                  </div>
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setDetailMode(detailMode === "edit" ? "view" : "edit")}
                    >
                      {detailMode === "edit" ? "Cancel Edit" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={deleteStudent}
                      disabled={isSaving}
                    >
                      {isSaving ? "Working..." : "Delete Student"}
                    </button>
                  </div>
                </div>

                <div className="detail-grid">
                  <label>
                    Student Name
                    <input
                      type="text"
                      disabled={detailMode !== "edit"}
                      value={selectedStudent.name}
                      onChange={(event) =>
                        setSelectedStudent({ ...selectedStudent, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Class
                    <input
                      type="text"
                      disabled={detailMode !== "edit"}
                      value={selectedStudent.className}
                      onChange={(event) =>
                        setSelectedStudent({ ...selectedStudent, className: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Batch Year
                    <input
                      type="text"
                      disabled={detailMode !== "edit"}
                      value={selectedStudent.batchYear}
                      onChange={(event) =>
                        setSelectedStudent({ ...selectedStudent, batchYear: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Phone Number
                    <input
                      type="tel"
                      disabled={detailMode !== "edit"}
                      value={selectedStudent.phoneNumber}
                      onChange={(event) =>
                        setSelectedStudent({ ...selectedStudent, phoneNumber: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Join Date
                    <input
                      type="date"
                      disabled={detailMode !== "edit"}
                      value={selectedStudent.joinDate}
                      onChange={(event) =>
                        setSelectedStudent({ ...selectedStudent, joinDate: event.target.value })
                      }
                    />
                  </label>
                </div>

                {detailMode === "edit" ? (
                  <button type="button" onClick={saveStudentDetails} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Student Details"}
                  </button>
                ) : null}

                <div className="month-section">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">Monthly Fee Status</span>
                      <h3>Track Paid And Remaining Amount</h3>
                    </div>
                  </div>

                  <div className="month-list">
                    {selectedStudent.fees.map((fee) => (
                      <div key={fee.monthNumber} className="month-row">
                        <div className="month-row-header">
                          <div className="month-name-block">
                            <label className="month-check">
                              <input
                                type="checkbox"
                                checked={fee.remainingAmount === 0}
                                onChange={(event) => {
                                  const nextPaidAmount = event.target.checked
                                    ? Number(selectedStudent.tuitionFee || 0)
                                    : 0;
                                  const nextFees = selectedStudent.fees.map((entry) =>
                                    entry.monthNumber === fee.monthNumber
                                      ? {
                                          ...entry,
                                          paid: event.target.checked,
                                          paidAmount: nextPaidAmount,
                                          remainingAmount: Math.max(
                                            Number(selectedStudent.tuitionFee || 0) - nextPaidAmount,
                                            0
                                          ),
                                          paidDate: event.target.checked
                                            ? entry.paidDate
                                            : ""
                                        }
                                      : entry
                                  );

                                  setSelectedStudent({ ...selectedStudent, fees: nextFees });
                                }}
                              />
                              <span>{monthLabels[fee.monthNumber - 1]}</span>
                            </label>
                            <span
                              className={
                                fee.remainingAmount === 0
                                  ? "status-chip paid"
                                  : "status-chip pending"
                              }
                            >
                              {fee.remainingAmount === 0 ? "Completed" : "Pending"}
                            </span>
                          </div>
                        </div>
                        <div className="month-fields">
                          <label>
                            Paid Amount
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={fee.paidAmount}
                              onChange={(event) => {
                                const amount = Math.max(Number(event.target.value || 0), 0);
                                const tuitionFee = Number(selectedStudent.tuitionFee || 0);
                                const cappedAmount = Math.min(amount, tuitionFee);
                                const nextFees = selectedStudent.fees.map((entry) =>
                                  entry.monthNumber === fee.monthNumber
                                    ? {
                                        ...entry,
                                        paid: cappedAmount >= tuitionFee,
                                        paidAmount: cappedAmount,
                                        remainingAmount: Math.max(tuitionFee - cappedAmount, 0),
                                        paidDate: cappedAmount > 0 ? entry.paidDate : ""
                                      }
                                    : entry
                                );

                                setSelectedStudent({ ...selectedStudent, fees: nextFees });
                              }}
                            />
                          </label>
                          <label>
                            Remaining
                            <input type="text" value={formatAmount(fee.remainingAmount)} disabled />
                          </label>
                          <label>
                            Paid Date
                            <input
                              type="date"
                              value={fee.paidDate}
                              disabled={fee.paidAmount <= 0}
                              onChange={(event) => {
                                const nextFees = selectedStudent.fees.map((entry) =>
                                  entry.monthNumber === fee.monthNumber
                                    ? { ...entry, paidDate: event.target.value }
                                    : entry
                                );

                                setSelectedStudent({ ...selectedStudent, fees: nextFees });
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button type="button" onClick={saveFees} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Fee Details"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-detail">
                <span className="eyebrow">Student Details</span>
                <h2>Select a student</h2>
                <p>
                  Click any student from the list to open their details, edit information, and
                  update each month's paid amount, remaining balance, and payment date.
                </p>
              </div>
            )}
          </aside>
        ) : null}
      </main>
    </div>
  );
}
