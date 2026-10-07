if (window.google && window.google.charts) {
    google.charts.load('current', { packages: ['corechart'] });
}

const PASSWORD_POLICY_MESSAGE = 'Use at least 10 characters with an uppercase letter, a lowercase letter, a number, and a special character.';
let sessionHeartbeatTimer = null;

function hasStrongPassword(password) {
    return password.length >= 10 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function setAuthenticatedUser(user) {
    const serviceNumber = user?.serviceNumber;
    const validUser = /^\d{6}$/.test(String(serviceNumber || ''));
    const overlay = document.getElementById('dashboardLoginOverlay');
    const appShell = document.querySelector('.app-shell');
    const adminPanel = document.getElementById('adminUserPanel');

    if (overlay) overlay.style.display = validUser ? 'none' : 'flex';
    if (appShell) appShell.style.display = validUser ? 'block' : 'none';
    if (adminPanel) adminPanel.hidden = !validUser || user.role !== 'admin';
    if (sessionHeartbeatTimer) { clearInterval(sessionHeartbeatTimer); sessionHeartbeatTimer = null; }
    if (validUser) {
        if (user.role === 'admin') loadAdminUsers();
        sessionHeartbeatTimer = setInterval(async () => {
            try {
                const response = await fetch('/api/me', { credentials: 'include', cache: 'no-store' });
                if (!response.ok) { clearInterval(sessionHeartbeatTimer); sessionHeartbeatTimer = null; setAuthenticatedUser(null); return; }
            } catch (error) { console.warn('Session heartbeat failed:', error); }
        }, 60000);
    }

    return validUser;
}

async function signInWithServiceNumber(serviceNumber, password, errorElement) {
    serviceNumber = String(serviceNumber || '').trim();
    if (!/^\d{6}$/.test(serviceNumber)) {
        if (errorElement) errorElement.textContent = 'Enter a valid 6-digit service number.';
        return false;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serviceNumber, password })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.user) {
            if (errorElement) errorElement.textContent = result.error || 'Service number or password is incorrect.';
            return false;
        }

        if (errorElement) errorElement.textContent = '';
        setAuthenticatedUser(result.user);
        return true;
    } catch (error) {
        console.error('Login failed:', error);
        if (errorElement) errorElement.textContent = 'Unable to contact the authentication service.';
        return false;
    }
}

async function restoreDashboardSession() {
    try {
        const response = await fetch('/api/me', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
            setAuthenticatedUser(null);
            return false;
        }

        const result = await response.json();
        const valid = setAuthenticatedUser(result.user);
        if (valid) await loadCloudData();
        return valid;
    } catch (error) {
        console.error('Unable to restore login session:', error);
        setAuthenticatedUser(null);
        return false;
    }
}

function setupAuth() {
    const form = document.getElementById('dashboardLoginForm');
    if (form) {
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const serviceNumber = document.getElementById('dashboardServiceNumber')?.value || '';
            const password = document.getElementById('dashboardPassword')?.value || '';
            const errorElement = document.getElementById('dashboardLoginError');

            const signedIn = await signInWithServiceNumber(serviceNumber, password, errorElement);
            if (!signedIn) return;

            form.reset();
            await loadCloudData();
        });
    }

    const logoutButton = document.getElementById('logoutDashboardBtn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
            setAuthenticatedUser(null);
        });
    }

    const adminForm = document.getElementById('addUserForm');
    if (adminForm) {
        adminForm.addEventListener('submit', async event => {
            event.preventDefault();
            const serviceNumber = document.getElementById('newUserServiceNumber').value.trim();
            const password = document.getElementById('newUserPassword').value;
            const message = document.getElementById('addUserMessage');
            const submitButton = adminForm.querySelector('button[type="submit"]');
            if (!/^\d{6}$/.test(serviceNumber)) { message.textContent = 'Enter a 6-digit service number.'; return; }
            if (!hasStrongPassword(password)) { message.textContent = PASSWORD_POLICY_MESSAGE; return; }
            submitButton.disabled = true;
            message.textContent = 'Creating account...';
            try {
                const response = await fetch('/api/admin/users', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                    body: JSON.stringify({ serviceNumber, password })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) { message.textContent = result.error || 'Could not create the account.'; return; }
                adminForm.reset();
                message.textContent = `Account created for service number ${serviceNumber}.`;
                await loadAdminUsers();
            } catch (error) {
                console.error('Create user failed:', error);
                message.textContent = 'Unable to contact the authentication service.';
            } finally { submitButton.disabled = false; }
        });
    }
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    if (refreshUsersBtn) refreshUsersBtn.addEventListener('click', loadAdminUsers);
    restoreDashboardSession();
}

async function loadAdminUsers() {
    const body = document.getElementById('adminUsersBody');
    if (!body) return;
    try {
        const response = await fetch('/api/admin/users', { credentials: 'include', cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to load users.');
        body.replaceChildren();
        (result.users || []).forEach(user => {
            const row = document.createElement('tr');
            const service = document.createElement('td'); service.textContent = user.service_number;
            const role = document.createElement('td'); role.textContent = user.role;
            const statusCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = user.online ? 'user-status online' : 'user-status offline';
            badge.textContent = user.online ? 'Online' : (user.active ? 'Offline' : 'Removed');
            statusCell.appendChild(badge);
            const seen = document.createElement('td');
            seen.textContent = user.online ? 'Active now' : (user.updated_at ? new Date(user.updated_at).toLocaleString() : '—');
            const actions = document.createElement('td');
            if (user.role === 'admin') {
                actions.textContent = 'Administrator';
            } else {
                const reset = document.createElement('button');
                reset.type = 'button'; reset.className = 'admin-action-btn reset'; reset.textContent = 'Reset Password';
                reset.onclick = () => resetTechnicianPassword(user.service_number);
                const remove = document.createElement('button');
                remove.type = 'button'; remove.className = 'admin-action-btn remove'; remove.textContent = 'Remove';
                remove.onclick = () => removeTechnician(user.service_number);
                actions.append(reset, remove);
            }
            row.append(service, role, statusCell, seen, actions);
            body.appendChild(row);
        });
        if (!body.children.length) body.innerHTML = '<tr><td colspan="5">No user accounts found.</td></tr>';
    } catch (error) {
        console.error('Load users failed:', error);
        body.innerHTML = `<tr><td colspan="5">${error.message || 'Unable to load users.'}</td></tr>`;
    }
}

async function resetTechnicianPassword(serviceNumber) {
    const password = window.prompt(`Enter a new password for ${serviceNumber}.\\n\\nAt least 10 characters: uppercase, lowercase, number and special character.`);
    if (password === null) return;
    if (!hasStrongPassword(password)) { showToast(PASSWORD_POLICY_MESSAGE, 'warning', 7000); return; }
    try {
        const response = await fetch('/api/admin/users/reset-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ serviceNumber, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to reset password.');
        showToast(`Password reset for ${serviceNumber}. The technician must log in again.`, 'success', 6000);
        await loadAdminUsers();
    } catch (error) { showToast(error.message || 'Unable to reset password.', 'error', 7000); }
}

async function removeTechnician(serviceNumber) {
    if (!window.confirm(`Remove technician account ${serviceNumber}? This will also sign out that technician.`)) return;
    try {
        const response = await fetch('/api/admin/users/' + encodeURIComponent(serviceNumber), { method: 'DELETE', credentials: 'include' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to remove user.');
        showToast(`Technician ${serviceNumber} was removed.`, 'success');
        await loadAdminUsers();
    } catch (error) { showToast(error.message || 'Unable to remove user.', 'error', 7000); }
}

function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) { console.log(`[${type}] ${message}`); return; }
    const icons = { success: '[+]', error: '[!]', warning: '[w]', info: '[i]' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

let dailySnapshots = [];
let viewingHistoricalSnapshot = false;
let csvModifiedAt = null;
let loadedCsvFileSignature = null;

function getLocalDayBounds(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
}

function formatSnapshotLabel(snapshot, index) {
    const modifiedTime = snapshot.csv_modified_at
        ? new Date(snapshot.csv_modified_at).toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
        : 'CSV modified time unavailable';
    return `${modifiedTime} - Version ${index + 1} - ${snapshot.tickets.length} tickets`;
}

function updateCsvModifiedDisplay(value) {
    const csvModifiedTimeEl = document.getElementById('csv-modified-time');
    if (!csvModifiedTimeEl) return;

    csvModifiedTimeEl.textContent = value
        ? new Date(value).toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
        : 'Not loaded';
}

function formatSnapshotTime(snapshot) {
    return new Date(snapshot.csv_modified_at || snapshot.captured_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function loadDailySnapshots() {
    const selector = document.getElementById('snapshotVersion');
    if (!selector) return;

    const { start, end } = getLocalDayBounds();
    try {
        const response = await fetch('/api/cloud/snapshots?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end), {
            credentials: 'include',
            cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to load cloud history.');

        dailySnapshots = (Array.isArray(result) ? result : []).sort((a, b) => {
            const aTime = Date.parse(a.csv_modified_at || a.captured_at || '') || 0;
            const bTime = Date.parse(b.csv_modified_at || b.captured_at || '') || 0;
            return aTime - bTime;
        });
        selector.replaceChildren();

        if (dailySnapshots.length === 0) {
            selector.add(new Option('No saved versions today', ''));
            selector.disabled = true;
            renderWorkloadChart();
            return;
        }

        dailySnapshots.forEach((snapshot, index) => {
            selector.add(new Option(formatSnapshotLabel(snapshot, index), String(snapshot.id)));
        });
        selector.disabled = false;
        selector.value = String(dailySnapshots[dailySnapshots.length - 1].id);
        viewingHistoricalSnapshot = false;
        csvModifiedAt = dailySnapshots[dailySnapshots.length - 1].csv_modified_at || null;
        updateCsvModifiedDisplay(csvModifiedAt);

        // loadCloudData() calls updateDashboard() before snapshot history is
        // loaded, so refresh the analytics metrics now that completed-ticket
        // history is available.
        if (Array.isArray(fullData) && fullData.length > 0) {
            updateDashboard(fullData);
        } else {
            renderWorkloadChart();
        }
    } catch (error) {
        dailySnapshots = [];
        selector.replaceChildren(new Option('History unavailable - check cloud access', ''));
        selector.disabled = true;
        console.error("Unable to load today's snapshots.", error);
        renderWorkloadChart();
    }
}

function loadSelectedSnapshot(snapshotId) {
    const snapshot = dailySnapshots.find(item => String(item.id) === String(snapshotId));
    if (!snapshot) return;

    viewingHistoricalSnapshot = snapshot !== dailySnapshots[dailySnapshots.length - 1];
    fullData = snapshot.tickets;
    csvModifiedAt = snapshot.csv_modified_at || null;
    updateCsvModifiedDisplay(csvModifiedAt);
    updateDashboard(fullData);
    renderTable();

    const cloudTimeEl = document.getElementById('cloud-updated-time');
    if (cloudTimeEl) {
        cloudTimeEl.textContent = new Date(snapshot.captured_at).toLocaleString();
    }
    const snapshotIndex = dailySnapshots.indexOf(snapshot);
    showToast(`Loaded ${formatSnapshotLabel(snapshot, snapshotIndex)}.`, 'success');
}

async function updateCloudData() {
    const csvFileInput = document.getElementById('csvFile');
    const selectedFile = csvFileInput?.files?.[0] || null;

    if (!selectedFile || !loadedCsvFileSignature) {
        return showToast('Select a CSV file first. Cloud upload is disabled until a CSV is loaded.', 'warning', 7000);
    }

    const currentFileSignature = [selectedFile.name, selectedFile.size, selectedFile.lastModified].join('|');
    if (currentFileSignature !== loadedCsvFileSignature) {
        return showToast('The selected CSV has changed. Please load the CSV again before uploading to Cloud.', 'warning', 7000);
    }

    const fileModifiedAt = new Date(selectedFile.lastModified);
    const nowLocal = new Date();
    const sameLocalDay =
        fileModifiedAt.getFullYear() === nowLocal.getFullYear() &&
        fileModifiedAt.getMonth() === nowLocal.getMonth() &&
        fileModifiedAt.getDate() === nowLocal.getDate();

    if (!Number.isFinite(fileModifiedAt.getTime())) {
        return showToast('The CSV modified time could not be read. Please select the CSV again.', 'error', 7000);
    }

    if (!sameLocalDay) {
        return showToast('Only a CSV modified today can be uploaded to Cloud. Please use today\'s CSV file.', 'warning', 8000);
    }

    if (!fullData || fullData.length === 0) {
        return showToast('No ticket data loaded to upload!', 'warning');
    }

    if (viewingHistoricalSnapshot) {
        return showToast('You are viewing an older version. Select today\'s latest version or load a new CSV before syncing.', 'warning', 7000);
    }

    const optimizedTickets = fullData.map(row => ({
        "Priority": row["Priority"] || "",
        "Circuit Display Name": row["Circuit Display Name"] || "",
        "Assigned WG": row["Assigned WG"] || "",
        "Outage": row["Outage"] || "",
        "Customer Name": row["Customer Name"] || "",
        "SA_ADDRESS": row["SA_ADDRESS"] || "",
        "FA_CONTACT_NUMBER": row["FA_CONTACT_NUMBER"] || "",
        "ID": row["ID"] || "",
        "Status": row["Status"] || "",
        "SA_DP_LOOP": row["SA_DP_LOOP"] || "",
        "SA_LEA": row["SA_LEA"] || "",
        "Description": row["Description"] || "",
        "Reported On": row["Reported On"] || "",
        "SA_SERVICE_TYPE": row["SA_SERVICE_TYPE"] || ""
    }));

    const capturedAt = new Date().toISOString();
    try {
        const stateResponse = await fetch('/api/cloud/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ tickets: optimizedTickets, updated_at: capturedAt, csv_modified_at: csvModifiedAt })
        });
        const stateResult = await stateResponse.json().catch(() => ({}));
        if (!stateResponse.ok) throw new Error(stateResult.error || 'Cloud state update failed.');

        const snapshotResponse = await fetch('/api/cloud/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                captured_at: capturedAt,
                csv_modified_at: csvModifiedAt,
                client_local_date: nowLocal.toLocaleDateString('en-CA'),
                tickets: optimizedTickets
            })
        });
        const snapshotResult = await snapshotResponse.json().catch(() => ({}));

        if (!snapshotResponse.ok) {
            console.error('Cloud updated, but the history snapshot was not saved.', snapshotResult);
            showToast('Cloud updated, but history could not be saved. ' + (snapshotResult.error || ''), 'warning', 9000);
            return;
        }

        const cloudTimeEl = document.getElementById('cloud-updated-time');
        if (cloudTimeEl) cloudTimeEl.textContent = new Date(capturedAt).toLocaleString();
        await loadDailySnapshots();
        showToast('Cloud updated and today\'s version saved.', 'success');
    } catch (error) {
        console.error('Cloud Error:', error);
        showToast('Failed to update cloud storage. ' + (error.message || ''), 'error', 9000);
    }
}

async function loadCloudData() {
    try {
        const response = await fetch('/api/cloud/state', {
            credentials: 'include',
            cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to load cloud data.');

        const data = result;
        if (data && Array.isArray(data.tickets) && data.tickets.length > 0) {
            fullData = data.tickets;
            updateDashboard(fullData);
            renderTable();

            if (data.updated_at) {
                const updateTime = new Date(data.updated_at);
                const formattedTime = updateTime.getFullYear() + '-' +
                    String(updateTime.getMonth() + 1).padStart(2, '0') + '-' +
                    String(updateTime.getDate()).padStart(2, '0') + ' ' +
                    String(updateTime.getHours()).padStart(2, '0') + ':' +
                    String(updateTime.getMinutes()).padStart(2, '0');
                const cloudTimeEl = document.getElementById("cloud-updated-time");
                if (cloudTimeEl) cloudTimeEl.textContent = formattedTime;
            }
        }
        await loadDailySnapshots();
    } catch (error) {
        console.error('No cloud data found or cloud access failed.', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    setupAuth();

    const csvFile = document.getElementById('csvFile');
    if (csvFile) {
        csvFile.addEventListener('change', handleFile);
    }
    
    const updateCloudBtn = document.getElementById('updateCloudBtn');
    if (updateCloudBtn) updateCloudBtn.onclick = updateCloudData;

    const snapshotVersion = document.getElementById('snapshotVersion');
    if (snapshotVersion) {
        snapshotVersion.addEventListener('change', event => loadSelectedSnapshot(event.target.value));
    }
    
    const cardFilterMap = {
        "gldu-ftth-card": "GLDUFTTH",
        "unwharim-ftth-card": "UNWHARIMFTTH",
        "gldu-card": "GLDU",
        "unwhar-card": "UNWHAR",
        "umnf-card": "UMNF",
        "im-card": "IM",
        "4g-card": "4G",
        "ug-card": "UG"
    };
    
    Object.keys(cardFilterMap).forEach(cardId => {
        const card = document.getElementById(cardId);
        if (card) {
            card.onclick = () => toggleFilter(cardFilterMap[cardId]);
        }
    });

    const printTableBtn = document.getElementById('printTable');
    if (printTableBtn) printTableBtn.addEventListener('click', printFilteredTable);

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.onclick = function() {
            document.getElementById('ticketModal').style.display = 'none';
        };
    }

    window.onclick = function(event) {
        const modal = document.getElementById('ticketModal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
});

function updateCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const currentTimeEl = document.getElementById("current-time");
    if (currentTimeEl) currentTimeEl.textContent = `${hours}:${minutes}:${seconds}`;
}

setInterval(updateCurrentTime, 1000);
updateCurrentTime();

function handleFile() {
    const file = document.getElementById("csvFile").files[0];
    loadedCsvFileSignature = null;
    if (!file) {
        csvModifiedAt = null;
        updateCsvModifiedDisplay(null);
        return;
    }

    const fileModifiedDate = new Date(file.lastModified);
    if (!Number.isFinite(fileModifiedDate.getTime())) {
        csvModifiedAt = null;
        updateCsvModifiedDisplay(null);
        showToast('Unable to read the CSV modified time.', 'error', 7000);
        return;
    }

    loadedCsvFileSignature = [file.name, file.size, file.lastModified].join('|');
    csvModifiedAt = fileModifiedDate.toISOString();
    updateCsvModifiedDisplay(csvModifiedAt);

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: results => {
            fullData = results.data.filter(row => row["Assigned WG"] && !row["Assigned WG"].includes("PM-SSU"));
            viewingHistoricalSnapshot = false;
            updateDashboard(fullData);
            renderTable();
        }
    });
}

const copperTeams = {
    "GL/STS/PS/01": [
        "GL-JLG", "GL-LDW", "GL-DNG", "GL-RHR", "GL-WKN"
    ],
    "GL/STS/PS/02": [
        "GL-KLP", "GL-MIP", "GL-HGL", "GL-EDS", "GL-WWJ", 
        "GL-NVN", "GL-BWT", "GL-KRP","HGL-DFA"
    ],
    "GL/STS/PS/03": [
        "GL-IYG", "GL-KBE", "GL-LBD", "GL-GOD", "GL-BGJ", 
        "GL-BLG", "GL-SDM", "GL-UVK", "GL-NRW", "GL-PDL"
    ],
    "GL/STS/PS/06": [
        "GL-KDD", "GL-KLH", "GL-MEG", "GL-PDW", "GL-SBP", 
        "GL-WLD", "GL-WNW", "GL-PDN", "GL-GFT"
    ],
    "GLOHWGGL4": [
        "GL-HRJ", "GL-HYR", "GL-MBJ", "GL-AKM", "GL-BGG", 
        "GL-PLN", "GL-RJG", "GL-TLG", "GL-WPJ", "GL-MKL", "GL-MLD"
    ],
    "GLOHWGGL5": [
        "DU-BOS", "DU-DFA", "DU-DPS", "DU-MWD", "DU-RGK", "DU-INM"
    ],
    "GLOHWGGL7": ["GL-ELR", "GL-GKT", "GL-KGK", "GL-012", "GL-DFA-A",
        "GL-DFA-B", "GL-DFA-C", "GL-PDR", "GL-GNT", "GL-MPT"
    ]
};

function calculateAlarmStatus(outageString) {
    if (!outageString || typeof outageString !== 'string' || !outageString.includes(':')) {
        return "N/A";
    }

    const parts = outageString.split(':');
    if (parts.length < 2) return "N/A";
    
    const totalHours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    
    if (isNaN(totalHours) || isNaN(minutes)) return "N/A";

    const totalOutageHours = totalHours + (minutes / 60);

    if (totalOutageHours > 72) {
        return "Critical Alarm";
    } else if (totalOutageHours > 48) {
        return "Major Alarm";
    } else if (totalOutageHours > 24) {
        return "Minor Alarm";
    } else {
        return "Normal";
    }
}

const columnsToShow = [
    "Priority", "Circuit Display Name", "Assigned WG", "Outage", 
    "Alarm Status", 
    "Customer Name", "SA_ADDRESS",
    "FA_CONTACT_NUMBER", "ID", "Status", "SA_DP_LOOP", "SA_LEA", "Description", "Reported On", "SA_SERVICE_TYPE"
];

let fullData = [];
let activeFilters = {
    GLDU: false,
    GLDUFTTH: false,
    UNWHAR: false,
    UNWHARIMFTTH: false,
    UMNF: false,
    IM: false,
    "4G": false,
    UG: false
};

function getIsCopperService(serviceType) {
    return serviceType.includes("V-VOICE COPPER") ||
           serviceType.includes("E-IPTV COPPER") || 
           serviceType.includes("BB-INTERNET COPPER");
}

function classifyCopper(row) {
    const serviceType = (row["SA_SERVICE_TYPE"] || "").toUpperCase();
    const dpLoop = (row["SA_DP_LOOP"] || "").toUpperCase().trim();
    const assignedWg = (row["Assigned WG"] || "").toUpperCase();

    const isCopperService = getIsCopperService(serviceType);
    
    if (!isCopperService) return "";
    if (assignedWg.includes("CDM")) return "UG Fault";
    
    for (let [team, keywords] of Object.entries(copperTeams)) {
        for (let kw of keywords) {
             const trimmedKw = kw.toUpperCase().trim();
            if (dpLoop.includes(trimmedKw)) {
                return team;
            }
        }
    }
    return "Unassigned OH Fault";
}

function updateActiveCardUI(activeFilterName) {
    const filterCardMap = {
        "GLDU": "gldu-card",
        "GLDUFTTH": "gldu-ftth-card",
        "UNWHAR": "unwhar-card",
        "UNWHARIMFTTH": "unwharim-ftth-card",
        "UMNF": "umnf-card",
        "IM": "im-card",
        "4G": "4g-card",
        "UG": "ug-card"
    };

    document.querySelectorAll('.dashboard-grid .info-card').forEach(card => {
        card.classList.remove('active-card');
    });

    activeCategory = activeFilterName;

    if (activeFilterName && filterCardMap[activeFilterName]) {
        const cardId = filterCardMap[activeFilterName];
        const cardElement = document.getElementById(cardId);
        if (cardElement) {
            cardElement.classList.add('active-card');
        }
    }

    renderWorkloadChart();
}

let activeCategory = null;

function toggleFilter(name) {
    const wasActive = activeFilters[name];

    for (const key in activeFilters) {
        activeFilters[key] = false;
    }

    let activeFilterName = null;

    if (!wasActive) {
        activeFilters[name] = true;
        activeFilterName = name;
    }

    updateActiveCardUI(activeFilterName);
    renderTable();
}

function isTicketPending(status) {
    return !status.includes("CLOSED") && !status.includes("RESOLVED") && !status.includes("CLEARED");
}

function isNeedCpeDescription(description) {
    const text = (description || '').trim().toUpperCase();
    return /NEED\s+(?:THE\s+)?CPE|NEED\s+ONT|NEED\s+TELE|NEED\s+STB/.test(text);
}

function summarizePendingAndNeedCpe(data) {
    let pending = 0;
    let needCpe = 0;

    data.forEach(row => {
        const status = (row["Status"] || "").trim().toUpperCase();
        if (!isTicketPending(status)) return;

        pending += 1;
        if (isNeedCpeDescription(row["Description"])) {
            needCpe += 1;
        }
    });

    return {
        pending,
        needCpe,
        otherPending: Math.max(0, pending - needCpe)
    };
}

function updateStatusCounts(categoryCounts, status, alarmStatus) {
    if (status.includes("OPEN")) {
        categoryCounts.Open++;
    } else if (status.includes("ACKNOWLEDGED") || status.includes("ASSIGNED")) {
        categoryCounts.Ack++;
    } else if (status.includes("CLOSED") || status.includes("RESOLVED") || status.includes("CLEARED")) {
        categoryCounts.Clear++;
    }
    
    const isPending = isTicketPending(status);
    
    if (isPending) {
        if (alarmStatus === "Minor Alarm") {
            categoryCounts.Minor = (categoryCounts.Minor || 0) + 1;
        } else if (alarmStatus === "Major Alarm") {
            categoryCounts.Major = (categoryCounts.Major || 0) + 1;
        } else if (alarmStatus === "Critical Alarm") {
            categoryCounts.Critical = (categoryCounts.Critical || 0) + 1;
        }
    }
}

function updateDashboard(data, renderResults = true) {
    const initialCountState = { Open: 0, Ack: 0, Clear: 0, Minor: 0, Major: 0, Critical: 0 };
    const counts = {
        GLDU: { ...initialCountState },
        GLDUFTTH: { ...initialCountState },
        UNWHAR: { ...initialCountState },
        UNWHARIMFTTH: { ...initialCountState },
        UMNF: { ...initialCountState },
        IM: { ...initialCountState },
        "4G": { ...initialCountState },
        UG: { ...initialCountState }
    };

    data.forEach(row => {
        const lea = (row["SA_LEA"] || "").trim().toUpperCase();
        const type = (row["SA_SERVICE_TYPE"] || "").trim().toUpperCase();
        const isUG = (row["Assigned WG"] || "").toUpperCase().includes("CDM");
        const circuit = (row["Circuit Display Name"] || "").trim().toUpperCase();
        const assignedWG = (row["Assigned WG"] || "").trim().toUpperCase();
        const dpLoop = (row["SA_DP_LOOP"] || "").trim().toUpperCase();
        
        const isCopperService = getIsCopperService(type); 
        
        const is4G_LTE_WG = assignedWG.includes("LTE");
        const is4G_CIRCUIT = circuit.includes("0913") || circuit.includes("94913");
        const is4G = !isCopperService && (is4G_LTE_WG || is4G_CIRCUIT); 
        const isFTTH = type.includes("FTTH");
        
        const status = (row["Status"] || "").trim().toUpperCase();
        const alarmStatus = calculateAlarmStatus(row["Outage"]); 
        
        const isUnwHarDpLoopStart = dpLoop.startsWith("UNW") || dpLoop.startsWith("HAR");

        if (isFTTH) {
            if (["GL", "DU"].includes(lea)) {
                updateStatusCounts(counts.GLDUFTTH, status, alarmStatus);
            } else if (["UNW", "HAR", "IM"].includes(lea)) {
                updateStatusCounts(counts.UNWHARIMFTTH, status, alarmStatus);
            }
        }
        else if (isUnwHarDpLoopStart && !isUG && !isFTTH && isCopperService) {
            updateStatusCounts(counts.UNWHAR, status, alarmStatus);
        }
        else if (["GL", "DU"].includes(lea) && !isUG && !is4G && !isFTTH && isCopperService) {
            updateStatusCounts(counts.GLDU, status, alarmStatus);
        } 
        else if (["UM", "NF"].includes(lea) && !isUG && !is4G && !isFTTH && isCopperService) {
            updateStatusCounts(counts.UMNF, status, alarmStatus);
        } 
        else if (lea === "IM" && !isUG && !is4G && !isFTTH && isCopperService) {
            updateStatusCounts(counts.IM, status, alarmStatus);
        } 
        else if (is4G) {
            updateStatusCounts(counts["4G"], status, alarmStatus);
        } 
        else if (isUG && ["GL", "DU", "HAR", "UNW", "UM", "NF", "IM"].includes(lea)) {
            updateStatusCounts(counts.UG, status, alarmStatus);
        }
    });

    if (!renderResults) return counts;

    const pendingSummary = summarizePendingAndNeedCpe(data);
    const analyticsPendingEl = document.getElementById('analytics-pending-count');
    const analyticsClearedEl = document.getElementById('analytics-cleared-count');
    const analyticsCompletedEl = document.getElementById('analytics-completed-count');
    const analyticsNeedCpeEl = document.getElementById('analytics-need-cpe-count');
    const completedToday = getCumulativeCompletedToday();

    // Cleared in the Total Tickets Distribution card is limited to
    // the SA_LEA areas GL, DU, NUW, IM, UM and NF, which are the
    // responsibility areas for this dashboard. The main table can still
    // display tickets from other SA_LEA values.
    // Completed remains a separate historical metric based on snapshot
    // comparison.
    const responsibleLeas = new Set(["GL", "DU", "NUW", "IM", "UM", "NF"]);
    const currentCleared = data.reduce((total, row) => {
        const lea = String(row["SA_LEA"] || "").trim().toUpperCase();
        const status = String(row["Status"] || "").trim().toUpperCase();
        const isCleared = status.includes("CLOSED") ||
            status.includes("RESOLVED") ||
            status.includes("CLEARED");

        return total + (responsibleLeas.has(lea) && isCleared ? 1 : 0);
    }, 0);

    if (analyticsPendingEl) analyticsPendingEl.textContent = pendingSummary.pending;
    if (analyticsClearedEl) analyticsClearedEl.textContent = currentCleared;
    if (analyticsCompletedEl) analyticsCompletedEl.textContent = completedToday.total;
    if (analyticsNeedCpeEl) analyticsNeedCpeEl.textContent = pendingSummary.needCpe;

    const updateCard = (cardPrefix, dataCounts) => {
        const updateText = (idSuffix, value) => {
            const el = document.getElementById(`${cardPrefix}-${idSuffix}`);
            if (el) el.textContent = value;
        };

        updateText("open", dataCounts.Open);
        updateText("ack", dataCounts.Ack);
        updateText("clear", dataCounts.Clear);

        const alarms = ["minor", "major", "critical"];
        alarms.forEach(alarmType => {
            const countKey = alarmType.charAt(0).toUpperCase() + alarmType.slice(1);
            const count = dataCounts[countKey] || 0; 
            updateText(`${alarmType}-count`, count);
            const bulbElement = document.getElementById(`${cardPrefix}-${alarmType}-bulb`);
            if (bulbElement) {
                if (count > 0) {
                    bulbElement.classList.add("is-blinking");
                    bulbElement.classList.remove("no-tickets"); 
                } else {
                    bulbElement.classList.remove("is-blinking");
                    bulbElement.classList.add("no-tickets"); 
                }
            }
        });
    };

    updateCard("gldu", counts.GLDU);
    updateCard("gldu-ftth", counts.GLDUFTTH);
    updateCard("unwhar", counts.UNWHAR);
    updateCard("unwharim-ftth", counts.UNWHARIMFTTH);
    updateCard("umnf", counts.UMNF);
    updateCard("im", counts.IM);
    updateCard("4g", counts["4G"]);
    updateCard("ug", counts.UG);

    let totalGLDUFTTH = counts.GLDUFTTH.Open + counts.GLDUFTTH.Ack;
    let totalUNWHARFTTH = counts.UNWHARIMFTTH.Open + counts.UNWHARIMFTTH.Ack;
    let totalGLDU = counts.GLDU.Open + counts.GLDU.Ack;
    let totalUNWHAR = counts.UNWHAR.Open + counts.UNWHAR.Ack;
    let totalUMNF = counts.UMNF.Open + counts.UMNF.Ack;
    let totalIM = counts.IM.Open + counts.IM.Ack;
    let total4G = counts["4G"].Open + counts["4G"].Ack;
    let totalUG = counts.UG.Open + counts.UG.Ack;

    google.charts.setOnLoadCallback(() => {
        renderSinglePieChart(
            totalGLDUFTTH, totalUNWHARFTTH, totalGLDU,
            totalUNWHAR, totalUMNF, totalIM, total4G, totalUG
        );
        const completedToday = getCumulativeCompletedToday();
        renderPendingNeedCpePieChart(
            pendingSummary.pending,
            pendingSummary.needCpe,
            completedToday.total
        );
    });

    if (renderResults) renderWorkloadChart();
    return counts;
}

function renderPendingNeedCpePieChart(pending, needCpe, completed) {
    const container = document.getElementById('pendingNeedCpePieChart');
    if (!container) return;

    const data = google.visualization.arrayToDataTable([
        ['Group', 'Count'],
        ['Pending', pending],
        ['Need CPE', needCpe],
        ['Completed', completed]
    ]);

    const options = {
        backgroundColor: 'transparent',
        pieHole: 0.45,
        colors: ['#475569', '#f59e0b', '#10b981'],
        pieSliceText: 'percentage',
        legend: {
            position: 'bottom',
            textStyle: { color: '#e2e8f0', fontSize: 11 }
        },
        chartArea: { width: '88%', height: '70%' }
    };

    const chart = new google.visualization.PieChart(container);
    chart.draw(data, options);
}

function normalizeTicketId(row) {
    return String(row?.["ID"] ?? "").trim().toUpperCase();
}

function getCompletedCounts(previousTickets, currentTickets) {
    const currentIds = new Set(
        (currentTickets || [])
            .map(normalizeTicketId)
            .filter(Boolean)
    );

    const completed = {
        GLDU: 0,
        GLDUFTTH: 0,
        UNWHAR: 0,
        UNWHARIMFTTH: 0,
        UMNF: 0,
        IM: 0,
        "4G": 0,
        UG: 0
    };

    (previousTickets || []).forEach(row => {
        const id = normalizeTicketId(row);
        if (!id || currentIds.has(id)) return;

        // A ticket that was already CLOSED / RESOLVED / CLEARED in the
        // previous snapshot is already counted as Cleared, not Completed.
        // Completed must represent tickets that disappeared while still
        // pending/open/acknowledged, so Cleared and Completed stay separate.
        const previousStatus = String(row["Status"] || "").trim().toUpperCase();
        const wasAlreadyCleared =
            previousStatus.includes("CLOSED") ||
            previousStatus.includes("RESOLVED") ||
            previousStatus.includes("CLEARED");
        if (wasAlreadyCleared) return;

        const counts = {};
        const type = (row["SA_SERVICE_TYPE"] || "").trim().toUpperCase();
        const lea = (row["SA_LEA"] || "").trim().toUpperCase();
        const isUG = (row["Assigned WG"] || "").toUpperCase().includes("CDM");
        const circuit = (row["Circuit Display Name"] || "").trim().toUpperCase();
        const assignedWG = (row["Assigned WG"] || "").trim().toUpperCase();
        const dpLoop = (row["SA_DP_LOOP"] || "").trim().toUpperCase();
        const isCopperService = getIsCopperService(type);
        const is4G = !isCopperService && (assignedWG.includes("LTE") || circuit.includes("0913") || circuit.includes("94913"));
        const isFTTH = type.includes("FTTH");
        const isUnwHarDpLoopStart = dpLoop.startsWith("UNW") || dpLoop.startsWith("HAR");

        if (isFTTH) {
            if (["GL", "DU"].includes(lea)) completed.GLDUFTTH++;
            else if (["UNW", "HAR", "IM"].includes(lea)) completed.UNWHARIMFTTH++;
        } else if (isUnwHarDpLoopStart && !isUG && isCopperService) {
            completed.UNWHAR++;
        } else if (["GL", "DU"].includes(lea) && !isUG && !is4G && isCopperService) {
            completed.GLDU++;
        } else if (["UM", "NF"].includes(lea) && !isUG && !is4G && !isFTTH && isCopperService) {
            completed.UMNF++;
        } else if (lea === "IM" && !isUG && !is4G && !isFTTH && isCopperService) {
            completed.IM++;
        } else if (is4G) {
            completed["4G"]++;
        } else if (isUG && ["GL", "DU", "HAR", "UNW", "UM", "NF", "IM"].includes(lea)) {
            completed.UG++;
        }

        void counts;
    });

    return completed;
}

function renderWorkloadChart() {
    const card = document.getElementById('workload-trend-card');
    const message = document.getElementById('workload-trend-message');
    const title = document.getElementById('workload-trend-title');
    const container = document.getElementById('workloadTrendChart');
    if (!card || !message || !title || !container) return;

    const categoryLabels = {
        GLDU: 'GL/DU Copper',
        GLDUFTTH: 'GL/DU FTTH',
        UNWHAR: 'UNW/HAR Copper',
        UNWHARIMFTTH: 'UNW/HAR/IM FTTH',
        UMNF: 'UM/NF Copper',
        IM: 'IM Copper',
        '4G': '4G',
        UG: 'UG Fault'
    };

    if (dailySnapshots.length === 0) {
        card.hidden = true;
        return;
    }

    const selectedCategory = activeCategory && categoryLabels[activeCategory] ? activeCategory : null;
    card.hidden = false;

    if (selectedCategory) {
        title.textContent = `${categoryLabels[selectedCategory]} Workload Trend`;
        message.textContent = 'Open, acknowledged, pending, and completed tickets. Completed means the ID existed in the previous CSV but is absent from the next CSV.';
    } else {
        title.textContent = 'All Information Cards — Workload Trend';
        message.textContent = 'Combined totals for all information cards. Completed means a ticket ID disappeared from the next CSV snapshot.';
    }

    google.charts.setOnLoadCallback(() => {
        let cumulativeCompleted = 0;

        const rows = dailySnapshots.map((snapshot, index) => {
            const counts = updateDashboard(snapshot.tickets, false);
            const selectedCounts = selectedCategory
                ? counts[selectedCategory]
                : Object.values(counts).reduce((total, category) => ({
                    Open: total.Open + category.Open,
                    Ack: total.Ack + category.Ack,
                    Clear: total.Clear + category.Clear
                }), { Open: 0, Ack: 0, Clear: 0 });

            // Each new CSV upload contributes the tickets that disappeared
            // since the previous upload. Keep adding those completed tickets
            // so the Completed trend is cumulative and never moves downward.
            if (index > 0) {
                const completedByCategory = getCompletedCounts(
                    dailySnapshots[index - 1].tickets,
                    snapshot.tickets
                );
                const completedThisUpload = selectedCategory
                    ? completedByCategory[selectedCategory]
                    : Object.values(completedByCategory).reduce((sum, value) => sum + value, 0);

                cumulativeCompleted += completedThisUpload;
            }

            return [
                formatSnapshotTime(snapshot),
                selectedCounts.Open,
                selectedCounts.Ack,
                selectedCounts.Clear,
                cumulativeCompleted
            ];
        });

        const chartData = google.visualization.arrayToDataTable([
            ['Time', 'Open', 'Acknowledged', 'Cleared Status', 'Completed'],
            ...rows
        ]);

        const chart = new google.visualization.LineChart(container);
        chart.draw(chartData, {
            backgroundColor: 'transparent',
            colors: ['#38bdf8', '#fbbf24', '#10b981', '#a78bfa'],
            chartArea: { left: 48, top: 20, width: '88%', height: '72%' },
            hAxis: { textStyle: { color: '#cbd5e1' }, slantedText: true },
            vAxis: { minValue: 0, textStyle: { color: '#cbd5e1' }, gridlines: { color: '#334155' } },
            legend: { position: 'bottom', textStyle: { color: '#e2e8f0' } },
            pointSize: 5
        });
    });
}

function renderTable() {
    const table = document.getElementById("output");
    let thead = table.querySelector('thead');
    let tbody = table.querySelector('tbody');

    if (!thead) {
        thead = document.createElement("thead");
        table.appendChild(thead);
    } else {
        thead.innerHTML = '';
    }
    if (!tbody) {
        tbody = document.createElement("tbody");
        table.appendChild(tbody);
    } else {
        tbody.innerHTML = '';
    }

    const headerRow = document.createElement("tr");
    ["Team Name", ...columnsToShow].forEach(col => {
        const th = document.createElement("th");
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow); 

    const filtered = fullData.filter(row => {
        const lea = (row["SA_LEA"] || "").trim().toUpperCase();
        const type = (row["SA_SERVICE_TYPE"] || "").trim().toUpperCase();
        const isUG = (row["Assigned WG"] || "").toUpperCase().includes("CDM");
        const circuit = (row["Circuit Display Name"] || "").trim().toUpperCase();
        const assignedWG = (row["Assigned WG"] || "").trim().toUpperCase();
        const dpLoop = (row["SA_DP_LOOP"] || "").trim().toUpperCase();
        
        const isCopperService = getIsCopperService(type); 
        
        const is4G_LTE_WG = assignedWG.includes("LTE");
        const is4G_CIRCUIT = circuit.includes("0913") || circuit.includes("94913");
        const is4G = !isCopperService && (is4G_LTE_WG || is4G_CIRCUIT);
        const isFTTH = type.includes("FTTH");
        
        const isUnwHarDpLoopStart = dpLoop.startsWith("UNW") || dpLoop.startsWith("HAR");

        let show = false;
        
        if (activeFilters["UNWHAR"]) {
            if (isUnwHarDpLoopStart && !isUG && !isFTTH && isCopperService) {
                show = true;
            }
        }
        else if (activeFilters["GLDU"]) {
            if (["GL", "DU"].includes(lea) && !isUG && !is4G && !isFTTH && isCopperService) {
                show = true;
            }
        }
        else if (activeFilters["GLDUFTTH"] && ["GL", "DU"].includes(lea) && isFTTH) show = true;
        else if (activeFilters["UNWHARIMFTTH"] && isFTTH && ["UNW", "HAR", "IM"].includes(lea)) show = true;
        else if (activeFilters["UMNF"]) {
            if (["UM", "NF"].includes(lea) && !isUG && !is4G && !isFTTH && isCopperService) {
                show = true;
            }
        }
        else if (activeFilters["IM"]) {
            if (lea === "IM" && !isUG && !is4G && !isFTTH && isCopperService) {
                show = true;
            }
        }
        else if (activeFilters["4G"]) {
            if (is4G) show = true;
        }
        else if (activeFilters["UG"]) {
            const validLea = ["GL", "DU", "HAR", "UNW", "UM", "NF", "IM"];
            if (isUG && validLea.includes(lea)) show = true;
        }

        const noActive = !Object.values(activeFilters).includes(true);
        return noActive || show; 
    });

    filtered.forEach(row => {
        const tr = document.createElement("tr");
        const team = classifyCopper(row);
        const alarmStatus = calculateAlarmStatus(row["Outage"]); 
        
        if (alarmStatus === "Minor Alarm") {
            tr.classList.add("minor-alarm");
        } else if (alarmStatus === "Major Alarm") {
            tr.classList.add("major-alarm");
        } else if (alarmStatus === "Critical Alarm") {
            tr.classList.add("critical-alarm");
        }
        
        tr.style.cursor = 'pointer';
        tr.onclick = () => openTicketModal(row, team, alarmStatus);
        
        const tdTeam = document.createElement("td");
        tdTeam.textContent = team;
        tr.appendChild(tdTeam);

        columnsToShow.forEach(col => {
            const td = document.createElement("td");
            if (col === "Alarm Status") {
                td.textContent = alarmStatus;
            } else {
                td.textContent = row[col] || "";
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

function printFilteredTable() {
    const table = document.getElementById('output');
    const tableClone = table.cloneNode(true); 

    const columnsToPrint = ["Priority", "Circuit Display Name", "Customer Name", "SA_ADDRESS", "FA_CONTACT_NUMBER", "ID", "SA_DP_LOOP", "Description"];
    const headerRow = tableClone.querySelector('thead tr');
    const bodyRows = tableClone.querySelectorAll('tbody tr');

    const originalHeaders = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent);
    const keepIndexes = originalHeaders
        .map((headerText, index) => columnsToPrint.includes(headerText) ? index : -1)
        .filter(index => index >= 0);

    const headerCells = Array.from(headerRow.querySelectorAll('th'));
    for (let i = headerCells.length - 1; i >= 0; i--) {
        if (!keepIndexes.includes(i)) {
            headerCells[i].remove();
        }
    }

    bodyRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        for (let i = cells.length - 1; i >= 0; i--) {
            if (!keepIndexes.includes(i)) {
                cells[i].remove();
            }
        }
    });

    Array.from(tableClone.querySelectorAll('tbody tr')).forEach(row => {
        if (row.querySelectorAll('td').length === 0) {
            row.remove();
        }
    });

    const printWindow = window.open('', '_blank');
    printWindow.document.write('<html><head><title>Filtered Table</title>');
    printWindow.document.write('<style>');
    printWindow.document.write('@page { size: A4 landscape; margin: 12mm; }');
    printWindow.document.write('body { margin: 0; padding: 12px; font-family: Arial, sans-serif; font-size: 10pt; }');
    printWindow.document.write('table { border-collapse: collapse; width: 100%; table-layout: fixed; }');
    printWindow.document.write('th, td { border: 1px solid #000; padding: 8px; text-align: left; word-wrap: break-word; }');
    printWindow.document.write('th { font-weight: 700; }');
    printWindow.document.write('td { font-weight: 400; }');
    printWindow.document.write('tbody tr { page-break-inside: avoid; }');
    printWindow.document.write('</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write('<table>');
    printWindow.document.write(tableClone.outerHTML);
    printWindow.document.write('</table>');
    printWindow.document.write('</body></html>');
    printWindow.document.close(); 

    printWindow.focus(); 
    printWindow.print(); 
    printWindow.close(); 
}

function renderSinglePieChart(ftth1, ftth2, gldu, unwhar, umnf, im, lte, ug) {
    const container = document.getElementById('totalTicketsPieChart');
    if (!container) return;

    const data = google.visualization.arrayToDataTable([
        ['Category', 'Open & Ack Tickets'],
        ['GL/DU FTTH', ftth1],
        ['UNW/HAR/IM FTTH', ftth2],
        ['GL/DU Copper', gldu],
        ['UNW/HAR Copper', unwhar],
        ['UM/NF Copper', umnf],
        ['IM Copper', im],
        ['4G / LTE', lte],
        ['UG Fault', ug]
    ]);

    const options = {
        backgroundColor: 'transparent',
        pieHole: 0.4,
        colors: ['#8b5cf6', '#6366f1', '#38bdf8', '#fbbf24', '#f97316', '#ef5350', '#10b981', '#ec4899'],
        legend: {
            position: 'right',
            textStyle: { color: '#e2e8f0', fontSize: 11 }
        },
        chartArea: { width: '85%', height: '80%' }
    };

    const chart = new google.visualization.PieChart(container);
    chart.draw(data, options);
}

function getCumulativeCompletedToday() {
    const completedIds = new Set();
    const completedByCategory = {
        GLDU: 0, GLDUFTTH: 0, UNWHAR: 0, UNWHARIMFTTH: 0,
        UMNF: 0, IM: 0, "4G": 0, UG: 0
    };

    for (let i = 1; i < dailySnapshots.length; i++) {
        const previousTickets = dailySnapshots[i - 1].tickets || [];
        const currentTickets = dailySnapshots[i].tickets || [];
        const currentIds = new Set(currentTickets.map(normalizeTicketId).filter(Boolean));

        previousTickets.forEach(row => {
            const id = normalizeTicketId(row);
            if (!id || currentIds.has(id) || completedIds.has(id)) return;

            // Only count the ID as Completed when the snapshot comparison
            // classifies it as a true completion. A ticket that disappeared
            // after already being CLOSED / RESOLVED / CLEARED must not be
            // added to Completed, otherwise Cleared + Completed gets combined.
            const completed = getCompletedCounts([row], currentTickets);
            const completedThisTicket = Object.values(completed).some(value => value > 0);
            if (!completedThisTicket) return;

            completedIds.add(id);
            for (const key of Object.keys(completedByCategory)) {
                completedByCategory[key] += completed[key];
            }
        });
    }

    return { total: completedIds.size, byCategory: completedByCategory };
}

function openTicketModal(rowObj, teamName, alarmStatus) {
    const modal = document.getElementById('ticketModal');
    const container = document.getElementById('modalTicketDetails');
    if (!modal || !container) return;

    const fieldsToDisplay = [
        { label: "Team Name", value: teamName },
        { label: "Circuit Display Name", value: rowObj["Circuit Display Name"] },
        { label: "Customer Name", value: rowObj["Customer Name"] },
        { label: "Service Address", value: rowObj["SA_ADDRESS"] },
        { label: "Contact Number", value: rowObj["FA_CONTACT_NUMBER"] },
        { label: "Ticket ID", value: rowObj["ID"] },
        { label: "Status", value: rowObj["Status"] },
        { label: "DP Loop", value: rowObj["SA_DP_LOOP"] },
        { label: "LEA", value: rowObj["SA_LEA"] },
        { label: "Description", value: rowObj["Description"] },
        { label: "Reported On", value: rowObj["Reported On"] },
        { label: "Alarm Status", value: alarmStatus }
    ];

    container.innerHTML = '';
    fieldsToDisplay.forEach(field => {
        const div = document.createElement('div');
        div.className = 'modal-field';
        div.innerHTML = `
            <span class="modal-field-label">${field.label}</span>
            <span class="modal-field-value">${field.value || 'N/A'}</span>
        `;
        container.appendChild(div);
    });

    modal.style.display = 'flex';
}
