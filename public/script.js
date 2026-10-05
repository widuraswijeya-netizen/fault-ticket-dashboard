if (window.google && window.google.charts) {
    google.charts.load('current', { packages: ['corechart'] });
}

const AUTH_EMAIL_DOMAIN = '@intranet.slt.com.lk';
const PASSWORD_POLICY_MESSAGE = 'Use at least 10 characters with an uppercase letter, a lowercase letter, a number, and a special character.';

function serviceNumberToEmail(serviceNumber) {
    const normalizedServiceNumber = String(serviceNumber || '').trim();
    const configuredEmail = APP_CONFIG.SERVICE_EMAILS?.[normalizedServiceNumber];
    return configuredEmail || `${normalizedServiceNumber}${AUTH_EMAIL_DOMAIN}`;
}

function hasStrongPassword(password) {
    return password.length >= 10 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function setAuthenticatedUser(user) {
    const serviceNumber = user?.app_metadata?.service_number;
    const validUser = /^\d{6}$/.test(String(serviceNumber || ''));
    const overlay = document.getElementById('dashboardLoginOverlay');
    const appShell = document.querySelector('.app-shell');
    const adminPanel = document.getElementById('adminUserPanel');

    if (overlay) overlay.style.display = validUser ? 'none' : 'flex';
    if (appShell) appShell.style.display = validUser ? 'block' : 'none';
    if (adminPanel) adminPanel.hidden = !validUser || user.app_metadata.role !== 'admin';

    return validUser;
}

async function signInWithServiceNumber(serviceNumber, password, errorElement) {
    if (!supabaseClient) {
        if (errorElement) errorElement.textContent = 'Authentication is not configured. Check the Supabase setup.';
        return false;
    }
    if (!/^\d{6}$/.test(String(serviceNumber || '').trim())) {
        if (errorElement) errorElement.textContent = 'Enter a valid 6-digit service number.';
        return false;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: serviceNumberToEmail(serviceNumber),
        password
    });
    if (error || !data.user) {
        if (errorElement) errorElement.textContent = 'Service number or password is incorrect.';
        return false;
    }
    if (data.user.app_metadata?.service_number !== String(serviceNumber).trim()) {
        await supabaseClient.auth.signOut();
        if (errorElement) errorElement.textContent = 'This account is not provisioned for dashboard access.';
        return false;
    }

    if (errorElement) errorElement.textContent = '';
    setAuthenticatedUser(data.user);
    return true;
}

function setupAuth() {
    const loginForms = [
        { formId: 'loginForm', serviceId: 'serviceNumber', passwordId: 'sharedPassword', errorId: 'loginError', redirect: true },
        { formId: 'dashboardLoginForm', serviceId: 'dashboardServiceNumber', passwordId: 'dashboardPassword', errorId: 'dashboardLoginError', redirect: false }
    ];

    loginForms.forEach(({ formId, serviceId, passwordId, errorId, redirect }) => {
        const form = document.getElementById(formId);
        if (!form) return;

        form.addEventListener('submit', async event => {
            event.preventDefault();
            const serviceNumber = document.getElementById(serviceId)?.value || '';
            const password = document.getElementById(passwordId)?.value || '';
            const errorElement = document.getElementById(errorId);
            const signedIn = await signInWithServiceNumber(serviceNumber, password, errorElement);
            if (!signedIn) return;

            form.reset();
            if (redirect) {
                window.location.href = 'Copper Dashboard.html';
            } else {
                await loadCloudData();
            }
        });
    });

    const logoutButton = document.getElementById('logoutDashboardBtn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            await supabaseClient.auth.signOut();
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

            if (!/^\d{6}$/.test(serviceNumber)) {
                message.textContent = 'Enter a 6-digit service number.';
                return;
            }
            if (!hasStrongPassword(password)) {
                message.textContent = PASSWORD_POLICY_MESSAGE;
                return;
            }

            submitButton.disabled = true;
            message.textContent = 'Creating account...';
            const { error } = await supabaseClient.functions.invoke('create-user', {
                body: { serviceNumber, password }
            });
            submitButton.disabled = false;

            if (error) {
                message.textContent = error.message || 'Could not create the account.';
                return;
            }

            adminForm.reset();
            message.textContent = `Account created for service number ${serviceNumber}.`;
        });
    }

    if (!supabaseClient) {
        setAuthenticatedUser(null);
        return;
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') setAuthenticatedUser(null);
        if (event === 'SIGNED_IN' && session?.user) setAuthenticatedUser(session.user);
    });

    supabaseClient.auth.getSession().then(async ({ data }) => {
        const isAuthenticated = setAuthenticatedUser(data.session?.user);
        if (isAuthenticated && document.querySelector('.app-shell')) await loadCloudData();
        else if (data.session && !isAuthenticated) await supabaseClient.auth.signOut();
    });
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

const supabaseUrl = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.SUPABASE_URL : '';
const supabaseKey = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.SUPABASE_ANON_KEY : '';
const supabaseClient = window.supabase && supabaseUrl && supabaseKey
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;
let dailySnapshots = [];
let viewingHistoricalSnapshot = false;
let csvModifiedAt = null;

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
    return new Date(snapshot.captured_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function loadDailySnapshots() {
    const selector = document.getElementById('snapshotVersion');
    if (!supabaseClient || !selector) return;

    const { start, end } = getLocalDayBounds();
    try {
        const { data, error } = await supabaseClient
            .from('app_snapshots')
            .select('id, captured_at, csv_modified_at, tickets')
            .gte('captured_at', start)
            .lt('captured_at', end)
            .order('captured_at', { ascending: true });

        if (error) throw error;

        dailySnapshots = data || [];
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
        renderWorkloadChart();
    } catch (error) {
        dailySnapshots = [];
        const message = error.code === 'PGRST205'
            ? 'Setup required: run supabase_snapshots.sql in Supabase'
            : 'History unavailable - check Supabase access';
        selector.replaceChildren(new Option(message, ''));
        selector.disabled = true;
        console.error('Unable to load today\'s snapshots.', error);
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
    if (!fullData || fullData.length === 0) {
        return showToast('No ticket data loaded to upload!', 'warning');
    }

    if (viewingHistoricalSnapshot) {
        return showToast('You are viewing an older version. Select today\'s latest version or load a new CSV before syncing.', 'warning', 7000);
    }

    if (!supabaseClient) {
        return showToast('Supabase not initialized. Check config.js', 'error');
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
        const { error } = await supabaseClient
            .from('app_state')
            .upsert({ 
                id: 1, 
                tickets: optimizedTickets, 
                updated_at: capturedAt
            });

        if (error) throw error;

        const { error: snapshotError } = await supabaseClient
            .from('app_snapshots')
            .insert({
                captured_at: capturedAt,
                csv_modified_at: csvModifiedAt || null,
                tickets: optimizedTickets
            });

        if (snapshotError) {
            console.error('Cloud updated, but the history snapshot was not saved.', snapshotError);
            const message = snapshotError.code === '42703'
                ? 'Cloud updated, but app_snapshots needs the csv_modified_at column. Rerun the updated supabase_snapshots.sql.'
                : 'Cloud updated, but history could not be saved. Check app_snapshots permissions and setup.';
            showToast(message, 'warning', 9000);
            return;
        }

        const cloudTimeEl = document.getElementById('cloud-updated-time');
        if (cloudTimeEl) cloudTimeEl.textContent = new Date(capturedAt).toLocaleString();
        await loadDailySnapshots();
        showToast('Cloud updated and today\'s version saved.', 'success');
    } catch (error) {
        console.error('Supabase Error:', error);
        showToast('Failed to update cloud storage. See console for details.', 'error');
    }
}

async function loadCloudData() {
    if (!supabaseClient) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('app_state')
            .select('tickets, updated_at')
            .eq('id', 1)
            .single();

        if (error) {
            if (error.code !== 'PGRST116') throw error;
            return;
        }

        if (data && data.tickets && data.tickets.length > 0) {
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
                if (cloudTimeEl) {
                    cloudTimeEl.textContent = formattedTime;
                }
            }
        }
        await loadDailySnapshots();
    } catch (error) {
        console.error('No cloud data found or offline.', error);
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
    if (!file) return;

    csvModifiedAt = new Date(file.lastModified).toISOString();
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
    const analyticsNeedCpeEl = document.getElementById('analytics-need-cpe-count');
    if (analyticsPendingEl) analyticsPendingEl.textContent = pendingSummary.pending;
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
        renderPendingNeedCpePieChart(pendingSummary.otherPending, pendingSummary.needCpe);
    });

    renderWorkloadChart();
    return counts;
}

function renderPendingNeedCpePieChart(otherPending, needCpe) {
    const container = document.getElementById('pendingNeedCpePieChart');
    if (!container) return;

    const data = google.visualization.arrayToDataTable([
        ['Group', 'Count'],
        ['Pending (other)', otherPending],
        ['Need CPE', needCpe]
    ]);

    const options = {
        backgroundColor: 'transparent',
        pieHole: 0.45,
        colors: ['#475569', '#f59e0b'],
        legend: {
            position: 'bottom',
            textStyle: { color: '#e2e8f0', fontSize: 11 }
        },
        chartArea: { width: '88%', height: '70%' }
    };

    const chart = new google.visualization.PieChart(container);
    chart.draw(data, options);
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

    if (!activeCategory || !categoryLabels[activeCategory]) {
        card.hidden = true;
        return;
    }

    card.hidden = false;
    title.textContent = `${categoryLabels[activeCategory]} Workload Trend`;

    if (dailySnapshots.length < 2) {
        container.replaceChildren();
        message.textContent = 'Save at least two cloud versions today to see workload changes.';
        return;
    }

    message.textContent = 'Open, acknowledged, and cleared tickets for this category across today\'s saved versions.';
    google.charts.setOnLoadCallback(() => {
        const rows = dailySnapshots.map(snapshot => {
            const counts = updateDashboard(snapshot.tickets, false)[activeCategory];
            return [formatSnapshotTime(snapshot), counts.Open, counts.Ack, counts.Clear];
        });
        const chartData = google.visualization.arrayToDataTable([
            ['Time', 'Open', 'Acknowledged', 'Clear'],
            ...rows
        ]);
        const chart = new google.visualization.LineChart(container);
        chart.draw(chartData, {
            backgroundColor: 'transparent',
            colors: ['#38bdf8', '#fbbf24', '#10b981'],
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
