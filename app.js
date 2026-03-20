// app.js - Complete Frontend Application Logic

let db = { posts: [], comments: [], saves: [], stories: [], categories: [], profiles: {}, friendData: {friends:[], pendingSent:[], pendingReceived:[]} };
let currentUser = ""; 
let currentRole = "user"; 
let currentFilter = "All"; 
let feedScopeMode = "global";
let pendingUploadList = []; 
let pendingProfUpload = { base64Data: null, fileName: null, mimeType: null };
let activeStoryQueue = []; 
let currentStoryIndex = 0; 
let storyTimer;
const roomPalette = ['#f97316', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#10b981', '#06b6d4', '#eab308'];
let cropperInstance = null;

import { cloud as api } from './cloud.js';

window.onload = function() { 
  const savedUser = localStorage.getItem('fireside_user');
  if (savedUser) { 
    currentUser = savedUser; 
    document.getElementById('active-user-display').innerText = currentUser; 
    document.querySelector('.header').style.display = 'flex'; 
    document.querySelector('.bottom-nav').style.display = 'flex'; 
    navTo('feed', document.querySelectorAll('.bottom-nav .nav-item')[0], true);
    syncData(); 
  } else { 
    navTo('login', null, true); 
  }
  initPullToRefresh();

  window.addEventListener('popstate', function(e) {
     const modals = [
        document.getElementById('comments-modal'), 
        document.getElementById('edit-profile-modal'), 
        document.getElementById('edit-post-modal'), 
        document.getElementById('story-viewer')
     ];
     let modalClosed = false;
     for(let i=0; i<modals.length; i++) {
        if(modals[i] && modals[i].classList.contains('active')) {
           modals[i].classList.remove('active');
           modalClosed = true;
        }
     }
     
     if(storyTimer) { 
        clearTimeout(storyTimer); 
        document.getElementById('story-media-container').innerHTML = ''; 
     }
     
     if(modalClosed) return; 

     const targetView = (e.state && e.state.view) ? e.state.view : 'feed';
     navTo(targetView, null, true);
  });
};

// --- PULL TO REFRESH LOGIC ---
function initPullToRefresh() {
   const ptrContent = document.getElementById('feed-container');
   const ptrIndicator = document.getElementById('ptr-indicator');
   let startY = 0; let currentY = 0; let isPulling = false;

   ptrContent.addEventListener('touchstart', function(e) {
       if(ptrContent.scrollTop === 0 && document.getElementById('view-feed').classList.contains('active')) {
           startY = e.touches[0].clientY;
           isPulling = true;
       }
   }, {passive: true});

   ptrContent.addEventListener('touchmove', function(e) {
       if(!isPulling) return;
       currentY = e.touches[0].clientY;
       if(currentY > startY && ptrContent.scrollTop === 0) {
           ptrIndicator.style.display = 'block';
           if(currentY - startY > 80) ptrIndicator.innerText = "↻ Release to refresh";
           else ptrIndicator.innerText = "↓ Pull to refresh";
       }
   }, {passive: true});

   ptrContent.addEventListener('touchend', function(e) {
       if(!isPulling) return;
       isPulling = false;
       if(currentY > startY + 80 && ptrContent.scrollTop === 0) {
           ptrIndicator.innerText = "Syncing network...";
           syncData();
           setTimeout(() => { ptrIndicator.style.display = 'none'; }, 1000);
       } else {
           ptrIndicator.style.display = 'none';
       }
   });
}

// --- CUSTOM DOUBLE TAP ENGINE ---
window.lastTapTime = 0;
window.lastTapElement = null;
window.customDoubleTap = function(postId, rowNum, event) {
    const now = new Date().getTime();
    const timeDiff = now - window.lastTapTime;
    if(timeDiff < 400 && timeDiff > 0 && window.lastTapElement === postId) {
        doDoubleTapLike(postId, rowNum, event);
        window.lastTapTime = 0; 
        if(event) event.preventDefault();
    } else {
        window.lastTapTime = now;
        window.lastTapElement = postId;
    }
}

// --- LIVE MENTION ENGINE ---
window.handleMentionInput = function(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const val = input.value;
    const cursor = input.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);
    const words = textBeforeCursor.split(/\s+/);
    const lastWord = words[words.length - 1];
    const dropdown = document.getElementById(dropdownId);

    if (lastWord.startsWith('@') && lastWord.length > 1) {
        const query = lastWord.substring(1).toLowerCase();
        const users = Object.keys(db.profiles);
        const matches = [];
        for(let i=0; i<users.length; i++) {
            if(users[i].toLowerCase().indexOf(query) !== -1) matches.push(users[i]);
        }

        if (matches.length > 0) {
            let html = '';
            for(let m=0; m<matches.length; m++) {
                html += '<div class="mention-item" onclick="insertMention(\'' + inputId + '\', \'' + matches[m] + '\', \'' + lastWord + '\', \'' + dropdownId + '\')">';
                html += getAvatarHtml(matches[m], 'mention-avatar') + '<span style="font-weight:700; font-size:14px; color:var(--primary);">' + matches[m] + '</span>';
                html += '</div>';
            }
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
        } else {
            dropdown.style.display = 'none';
        }
    } else {
        dropdown.style.display = 'none';
    }
}

window.insertMention = function(inputId, username, searchWord, dropdownId) {
    const input = document.getElementById(inputId);
    const val = input.value;
    const cursor = input.selectionStart;

    const textBefore = val.substring(0, cursor);
    const textAfter = val.substring(cursor);

    const newTextBefore = textBefore.substring(0, textBefore.lastIndexOf(searchWord)) + '@' + username + ' ';
    input.value = newTextBefore + textAfter;

    document.getElementById(dropdownId).style.display = 'none';
    input.focus();
}

window.applyThemeMode = function(theme) { 
  if (theme === 'light') { document.body.classList.add('light-mode'); document.getElementById('theme-toggle').checked = true; } 
  else { document.body.classList.remove('light-mode'); document.getElementById('theme-toggle').checked = false; } 
  applyRoomVibe(currentFilter); 
}

window.toggleTheme = async function(checkbox) { 
  const mode = checkbox.checked ? 'light' : 'dark'; 
  applyThemeMode(mode);
  if(db.profiles && db.profiles[currentUser]) db.profiles[currentUser].theme = mode; 
  try { await api.updateThemeMode(currentUser, mode); } catch(e){}
}

function getRoomColor(str) { 
  if(str === 'All' || str === '24h' || str === 'General') return '#f97316';
  let hash = 0; 
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return roomPalette[Math.abs(hash) % roomPalette.length]; 
}

function hexToRgb(hex) { 
  const bigint = parseInt(hex.replace('#',''), 16);
  return ((bigint >> 16) & 255) + "," + ((bigint >> 8) & 255) + "," + (bigint & 255);
}

function applyRoomVibe(roomStr) { 
  const color = getRoomColor(roomStr); 
  const isLight = document.body.classList.contains('light-mode'); 
  const rgb = hexToRgb(color);
  document.documentElement.style.setProperty('--accent', color); 
  document.documentElement.style.setProperty('--hashtag', color); 
  document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ', ' + (isLight ? '0.05' : '0.12') + ')');
}

function getAvatarHtml(username, extraClass) { 
  const cls = extraClass ? 'post-avatar ' + extraClass : 'post-avatar';
  if(db.profiles && db.profiles[username] && db.profiles[username].profilePic) { 
    return '<img src="' + db.profiles[username].profilePic + '" class="' + cls + '" style="object-fit:cover; padding:0; border:none;" onclick="openProfile(\'' + username + '\')">';
  } 
  return '<div class="' + cls + '" onclick="openProfile(\'' + username + '\')">' + (username ? username.charAt(0) : '?') + '</div>'; 
}

function getBadgeHtml(badges) {
    if(!badges || badges.length === 0) return '';
    let html = '<div style="display:inline-flex; gap:4px; margin-left:8px; vertical-align:middle;">';
    for(let i=0; i<badges.length; i++) {
        const b = badges[i];
        let bg = '#444'; let color = '#fff'; let icon = '';
        if(b === 'Dev') { bg = '#FFD700'; color = '#000'; icon = '👑'; }
        else if(b === 'Top Poster') { bg = '#3b82f6'; icon = '🔥'; }
        else if(b === 'Top Commenter') { bg = '#10b981'; icon = '💬'; }
        else if(b === 'Verified') { bg = '#1d9bf0'; icon = '✓'; }
        html += '<span style="background:' + bg + '; color:' + color + '; padding:2px 6px; border-radius:12px; font-size:10px; font-weight:800; display:inline-flex; align-items:center; gap:2px; box-shadow:0 2px 4px rgba(0,0,0,0.3);">' + icon + ' ' + b + '</span>';
    }
    html += '</div>';
    return html;
}

window.toggleAuthMode = function(mode) { 
  if (mode === 'signup') { 
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'block'; 
    document.getElementById('auth-subtitle').innerText = "Join the campfire."; 
  } else { 
    document.getElementById('signup-form').style.display = 'none'; 
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('auth-subtitle').innerText = "Connect with the family."; 
  } 
}

window.toggleAdminUI = function() { 
  const adminSec = document.getElementById('admin-settings-section');
  if (adminSec) adminSec.style.display = (currentRole === 'admin') ? 'block' : 'none';
}

window.attemptLogin = async function() { 
  const u = document.getElementById('login-username').value; 
  const p = document.getElementById('login-password').value;
  if (!u || !p) { showToast("Credentials required."); return; } 
  
  loading(true, "Authenticating...");
  try {
    const res = await api.authenticateUser(u, p);
    loading(false);
    if (res.error) { showToast(res.message); } 
    else { 
      currentUser = res.user.username; 
      currentRole = res.user.role ? res.user.role.toLowerCase() : 'user'; 
      localStorage.setItem('fireside_user', currentUser); 
      applyThemeMode(res.user.theme); 
      toggleAdminUI(); 
      document.querySelector('.header').style.display = 'flex'; 
      document.querySelector('.bottom-nav').style.display = 'flex'; 
      document.getElementById('active-user-display').innerText = currentUser; 
      navTo('feed', document.querySelectorAll('.bottom-nav .nav-item')[0]); 
      syncData(); 
      showToast("Welcome back, " + currentUser); 
    }
  } catch (err) {
    loading(false); showToast("Server connection failed.");
  }
};

window.attemptRegister = async function() { 
  const u = document.getElementById('reg-username').value.trim(); 
  const p = document.getElementById('reg-password').value; 
  const c = document.getElementById('reg-confirm').value;
  
  if (!u || !p || !c) { showToast("All fields are required."); return; } 
  if (p !== c) { showToast("Passwords do not match."); return; } 
  if (p.length < 6) { showToast("Password must be at least 6 characters."); return; } 
  
  loading(true, "Forging account...");
  try {
    const res = await api.registerUser(u, p);
    loading(false);
    if (res.error) showToast(res.message); 
    else { 
      showToast("Account created! Please log in."); 
      toggleAuthMode('login'); 
      document.getElementById('login-username').value = u; 
      document.getElementById('login-password').value = ''; 
    }
  } catch(err) {
    loading(false); showToast("Registration failed.");
  }
};

window.updatePassword = async function() { 
  const currentP = document.getElementById('sec-current-pass').value; 
  const newP = document.getElementById('sec-new-pass').value;
  if (!currentP || !newP) { showToast("Please fill out both fields."); return; } 
  if (newP.length < 6) { showToast("New password must be at least 6 characters."); return; } 
  
  loading(true, "Updating security...");
  try {
     const res = await api.changePassword(currentUser, currentP, newP);
     loading(false);
     if(res.error) showToast(res.message);
     else {
        showToast("Password updated successfully."); 
        document.getElementById('sec-current-pass').value = ''; 
        document.getElementById('sec-new-pass').value = ''; 
     }
  } catch(e) { loading(false); showToast("Error connecting."); }
}

window.updateUsername = async function() {
  const newU = document.getElementById('sec-new-user').value.trim();
  if(!newU || newU.length < 3) { showToast("Username too short."); return; }
  if(confirm("Change username to " + newU + "? This cascades across the network.")) {
     loading(true, "Rewriting identity...");
     try {
        const res = await api.changeUsername(currentUser, newU);
        loading(false);
        if(res.error) showToast(res.message);
        else {
            currentUser = res.newUsername;
            localStorage.setItem('fireside_user', currentUser);
            document.getElementById('active-user-display').innerText = currentUser;
            document.getElementById('sec-new-user').value = '';
            syncData();
        }
     } catch(e) { loading(false); showToast("Network Error."); }
  }
}

window.logout = function() { 
  localStorage.removeItem('fireside_user'); 
  currentUser = ""; 
  currentRole = "user"; 
  document.getElementById('user-dropdown').classList.remove('active'); 
  applyThemeMode('dark'); 
  navTo('login');
}

function formatCaption(text) { 
  if (!text) return "";
  let f = text.replace(/#(\w+)/g, '<span class="hashtag">#$1</span>'); 
  f = f.replace(/@(\w+)/g, '<span class="hashtag" style="cursor:pointer;" onclick="openProfile(\'$1\'); event.stopPropagation();">@$1</span>'); 
  return f.replace(/(https?:\/\/[^\s]+)/g, '<a class="ext-link" href="$1" target="_blank">$1</a>');
}

function timeAgo(ms) { 
  if (!ms || ms === 0) return "Unknown";
  const sec = Math.floor((new Date() - ms) / 1000); 
  if (sec < 60) return "Just now";
  if (sec < 3600) return Math.floor(sec/60) + "m ago"; 
  if (sec < 86400) return Math.floor(sec/3600) + "h ago";
  return Math.floor(sec/86400) + "d ago"; 
}

function parseReactions(likesArray) { 
  const dict = {}; 
  let userReact = null;
  for (let i=0; i<likesArray.length; i++) { 
    const p = likesArray[i].split('|'); 
    const u = p[0], r = p[1] || '❤️';
    dict[u] = r; 
    if (u === currentUser) userReact = r; 
  } 
  return { map: dict, myReaction: userReact, total: Object.keys(dict).length };
}

function generateReactionsText(reactData) { 
  const users = Object.keys(reactData.map);
  if (users.length === 0) return "Be the first to react"; 
  const hasMe = users.indexOf(currentUser) !== -1; 
  let reactIcons = "";
  const seen = {}; 
  for(let i=0; i<users.length; i++) { 
    const icon = reactData.map[users[i]]; 
    if(!seen[icon]) { reactIcons += icon; seen[icon]=true; } 
  } 
  if (users.length === 1) return hasMe ? reactIcons + " <strong>You</strong> reacted" : reactIcons + " <strong>" + users[0] + "</strong> reacted";
  if (users.length === 2) { 
    const other = users[0] === currentUser ? users[1] : users[0]; 
    return hasMe ? reactIcons + " <strong>You</strong> and <strong>" + other + "</strong>" : reactIcons + " <strong>" + users[0] + "</strong> and <strong>" + users[1] + "</strong>";
  } 
  return hasMe ? reactIcons + " <strong>You</strong> and <strong>" + (users.length - 1) + " others</strong>" : reactIcons + " <strong>" + users[0] + "</strong> and <strong>" + (users.length - 1) + " others</strong>";
}

window.showToast = function(msg) { 
  const cont = document.getElementById('toast-container'); 
  const t = document.createElement('div'); 
  t.className = 'toast';
  t.innerText = msg; 
  cont.appendChild(t); 
  setTimeout(() => t.classList.add('show'), 10); 
  setTimeout(() => { 
    t.classList.remove('show'); 
    setTimeout(() => t.remove(), 300); 
  }, 3000);
}

window.loading = function(show, msg) { 
  document.getElementById('loader-msg').innerText = msg || "Syncing..."; 
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

window.processResponse = function(res, cb) { 
  loading(false);
  if (res && res.error) { showToast("Backend Error: " + res.message); return; } 
  db = res || { posts: [], comments: [], saves: [], stories: [], categories: [], profiles: {}, friendData: {friends:[], pendingSent:[], pendingReceived:[]} };
  if(db.profiles && db.profiles[currentUser]) {
     applyThemeMode(db.profiles[currentUser].theme);
     currentRole = db.profiles[currentUser].role ? db.profiles[currentUser].role.toLowerCase() : 'user';
     toggleAdminUI();
  }
  checkNotifications();
  if (cb) cb();
}

window.navTo = function(viewId, el, skipHistory) { 
  const v = document.querySelectorAll('.view'); 
  for (let i=0; i<v.length; i++) v[i].classList.remove('active');
  const n = document.querySelectorAll('.nav-item, .top-icon'); 
  for (let j=0; j<n.length; j++) n[j].classList.remove('active'); 
  
  document.getElementById('view-' + viewId).classList.add('active'); 
  if (el) el.classList.add('active'); 
  
  const contentContainer = document.getElementById('feed-container');
  if (contentContainer) contentContainer.scrollTop = 0;
  
  if(viewId === 'login') { 
    document.querySelector('.header').style.display = 'none'; 
    document.querySelector('.bottom-nav').style.display = 'none'; 
  } else { 
    document.querySelector('.header').style.display = 'flex'; 
    document.querySelector('.bottom-nav').style.display = 'flex'; 
  } 
  if(viewId === 'notifications') renderNotifications(); 
  if(viewId === 'search') { document.getElementById('user-search-input').value = ''; performUserSearch(); }
  if(viewId === 'admin') { loadAdminBadgeDashboard(); }

  if(!skipHistory && viewId !== 'login') {
     history.pushState({view: viewId}, "", "#" + viewId);
  }
}

function pushModalState(modalName) {
    history.pushState({modal: modalName}, "", "#" + modalName);
}

window.toggleUserDropdown = function() { document.getElementById('user-dropdown').classList.toggle('active'); }

function renderUserUI() { 
  let dh = '<div class="user-opt" style="color:var(--text-sub);">Logged in as<br><strong style="color:var(--primary); font-size:16px;">' + currentUser + '</strong></div>';
  dh += '<div class="user-opt" onclick="openProfile(\'' + currentUser + '\')">👤 My Profile</div>'; 
  dh += '<div class="user-opt" onclick="logout()" style="color:#ef4444;">Log Out 👋</div>'; 
  document.getElementById('user-dropdown').innerHTML = dh;
}

function renderCategoryUI() {
  if(!db.categories || db.categories.length===0) db.categories=["General"]; 
  let sh=''; let opt='';
  let fb = '<div class="room-chip ' + (currentFilter==='All'?'active':'') + '" onclick="setFilter(\'All\', this)"><span class="room-dot" style="background:#f97316;"></span>All</div>';
  fb += '<div class="room-chip ' + (currentFilter==='24h'?'active':'') + '" onclick="setFilter(\'24h\', this)"><span class="room-dot" style="background:#f97316;"></span>Last 24h</div>';
  
  for(let i=0; i<db.categories.length; i++) {
    const cat = db.categories[i]; 
    const cColor = getRoomColor(cat);
    sh += '<div style="display:flex; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--border); font-size:15px; font-weight:600;">' +
             '<div style="display:flex; align-items:center; gap:10px;"><span class="room-dot" style="background:' + cColor + ';"></span><span>' + cat + '</span></div>' +
             '<span style="color:#ef4444; cursor:pointer;" onclick="removeCategory(\'' + cat + '\')">✕</span>' +
           '</div>';
    opt += '<option value="' + cat + '">' + cat + '</option>';
    fb += '<div class="room-chip ' + (currentFilter===cat?'active':'') + '" onclick="setFilter(\'' + cat + '\', this)"><span class="room-dot" style="background:' + cColor + ';"></span>' + cat + '</div>';
  }
  document.getElementById('cats-list-container').innerHTML = sh; 
  document.getElementById('post-category').innerHTML = opt; 
  document.getElementById('filter-bar-container').innerHTML = fb;
}

window.addCategory = async function() { 
  const c = document.getElementById('new-cat-name').value; 
  if (!c) return; 
  loading(true, "Building Room...");
  try {
     const res = await api.addAppCategory(c);
     processResponse(res, () => { 
       document.getElementById('new-cat-name').value=''; 
       renderCategoryUI(); showToast("Room Added."); 
     }); 
  } catch(e) { loading(false); showToast("Error adding room."); }
}

window.removeCategory = async function(c) { 
  if(confirm("Dismantle Room '" + c + "'?")) { 
    loading(true, "Removing...");
    try {
       const res = await api.removeAppCategory(c);
       processResponse(res, () => { renderCategoryUI(); showToast("Removed."); }); 
    } catch(e) { loading(false); showToast("Error removing room."); }
  } 
}

window.syncData = async function() { 
  loading(true, "Syncing Fireside...");
  try {
    const res = await api.getSocialData(currentUser);
    processResponse(res, () => { 
      renderUserUI(); 
      renderCategoryUI(); 
      renderStoriesUI(); 
      renderFeed(); 
      showToast("Synced 🔥"); 
    }); 
  } catch (err) {
    loading(false); showToast("Network Error.");
  }
};

window.performUserSearch = function() {
  const q = document.getElementById('user-search-input').value.toLowerCase();
  const resDiv = document.getElementById('search-results-list');
  let html = '';
  
  const users = db.profiles ? Object.keys(db.profiles) : [];
  let count = 0;
  for(let i=0; i<users.length; i++) {
    const u = users[i];
    if(u === currentUser) continue; 
    if(db.profiles[u].hideFromSearch === true) continue; 
    
    if(q === '' || u.toLowerCase().indexOf(q) !== -1) {
      const badges = db.profiles[u].badges || [];
      html += '<div class="friend-list-item" style="cursor:pointer;" onclick="openProfile(\'' + u + '\')">';
      html += '<div style="display:flex; align-items:center; gap:10px;">' + getAvatarHtml(u) + '<strong style="color:var(--primary); font-size:16px;">' + u + '</strong>' + getBadgeHtml(badges) + '</div>';
      html += '<span style="color:var(--text-sub); font-size:20px;">›</span>';
      html += '</div>';
      count++;
    }
  }
  if(count === 0) html = '<p style="color:var(--text-sub); text-align:center; margin-top:40px;">No users found matching "' + q + '".</p>';
  resDiv.innerHTML = html;
}

window.submitBadgeApp = async function() {
    const type = document.getElementById('badge-apply-select').value;
    loading(true, "Sending Application...");
    try {
        const res = await api.applyForBadge(currentUser, type);
        loading(false);
        if(res.error) showToast(res.message);
        else showToast(res.message);
    } catch(e) { loading(false); showToast("Network Error."); }
}

window.loadAdminBadgeDashboard = async function() {
    loading(true, "Fetching Badge Requests...");
    try {
        const res = await api.adminGetBadgeRequests(currentUser);
        loading(false);
        if(res.error) return;
        const reqs = res.requests;
        let h = '';
        if(reqs.length === 0) h = '<p style="color:var(--text-sub); font-size:13px;">No pending badge applications.</p>';
        for(let i=0; i<reqs.length; i++) {
            h += '<div style="background:var(--bg); border:1px solid var(--border); padding:10px; border-radius:8px; margin-bottom:10px;">';
            h += '<strong>' + reqs[i].username + '</strong> requested <span style="color:var(--accent); font-weight:bold;">' + reqs[i].badge + '</span>';
            h += '<div style="display:flex; gap:10px; margin-top:10px;"><button class="btn-small" style="background:#10b981; color:#fff; border:none;" onclick="adminProcessBadge(\'' + reqs[i].reqId + '\', \'' + reqs[i].username + '\', \'' + reqs[i].badge + '\', \'Approved\')">Approve</button>';
            h += '<button class="btn-small" style="background:#ef4444; color:#fff; border:none;" onclick="adminProcessBadge(\'' + reqs[i].reqId + '\', \'' + reqs[i].username + '\', \'' + reqs[i].badge + '\', \'Denied\')">Deny</button></div></div>';
        }
        document.getElementById('admin-badge-requests-list').innerHTML = h;
    } catch(e) { loading(false); }
}

window.adminProcessBadge = async function(reqId, user, badge, action) {
    loading(true, action + " Badge...");
    try {
        const res = await api.adminResolveBadge(currentUser, reqId, user, badge, action);
        loading(false);
        if(res.error) showToast("Error resolving badge.");
        else { showToast("Resolved!"); syncData(); loadAdminBadgeDashboard(); }
    } catch(e) { loading(false); showToast("Network error."); }
}

window.adminForceAssignBadge = async function() {
    const u = document.getElementById('admin-assign-user').value.trim();
    const b = document.getElementById('admin-assign-badge').value.trim();
    if(!u || !b) { showToast("Enter username and badge type."); return; }
    loading(true, "Granting Badge...");
    try {
        const res = await api.adminDirectAssignBadge(currentUser, u, b);
        loading(false);
        if(res.error) showToast(res.message);
        else { 
            showToast("Badge Granted to " + u); 
            document.getElementById('admin-assign-user').value = '';
            document.getElementById('admin-assign-badge').value = '';
            syncData(); 
        }
    } catch(e) { loading(false); showToast("Network Error."); }
}

window.adminForceRemoveBadge = async function() {
    const u = document.getElementById('admin-assign-user').value.trim();
    const b = document.getElementById('admin-assign-badge').value.trim();
    if(!u || !b) { showToast("Enter username and badge type."); return; }
    loading(true, "Revoking Badge...");
    try {
        const res = await api.adminRemoveBadge(currentUser, u, b);
        loading(false);
        if(res.error) showToast(res.message);
        else { 
            showToast("Badge Revoked from " + u); 
            document.getElementById('admin-assign-user').value = '';
            document.getElementById('admin-assign-badge').value = '';
            syncData(); 
        }
    } catch(e) { loading(false); showToast("Network error."); }
}

window.openAdminDashboard = async function() { 
  navTo('admin');
  loading(true, "Authenticating secure network..."); 
  try {
     const res = await api.adminGetUsers(currentUser);
     loading(false); 
     if(res.error) { showToast(res.message); navTo('settings'); return; } 
     renderAdminUsers(res.users); 
  } catch(e) { loading(false); showToast("Network error."); navTo('settings'); }
}

function renderAdminUsers(users) { 
  let h = ''; 
  for(let i=0; i<users.length; i++) { 
    const u = users[i];
    h += '<div class="settings-list" style="padding:16px; margin-bottom:16px; border:1px solid rgba(239, 68, 68, 0.4);">' +
            '<div class="form-group"><label style="font-size:12px; color:var(--text-sub); font-weight:700;">Username</label><input type="text" id="admin-u-' + u.userId + '" class="form-input" value="' + u.username + '"></div>' +
            '<div class="form-group"><label style="font-size:12px; color:var(--text-sub); font-weight:700;">Password</label><input type="text" id="admin-p-' + u.userId + '" class="form-input" value="' + u.password + '"></div>' +
            '<div class="form-group"><label style="font-size:12px; color:var(--text-sub); font-weight:700;">Network Role</label><select id="admin-r-' + u.userId + '" class="form-input"><option value="user" ' + (String(u.role).toLowerCase()==='user'?'selected':'') + '>User</option><option value="admin" ' + (String(u.role).toLowerCase()==='admin'?'selected':'') + '>Admin</option></select></div>' +
            '<button class="btn" style="background:var(--surface); color:var(--primary); border:1px solid var(--border); width:100%; padding:14px; font-size:14px; box-shadow:none;" onclick="adminSaveUser(\'' + u.userId + '\')">Save User Changes</button>' +
            '<button class="btn" style="background:#8b0000; border:none; width:100%; padding:14px; font-size:14px; margin-top:8px;" onclick="adminDeleteUserTrigger(\'' + u.userId + '\', \'' + u.username + '\')">Permanently Delete User</button>' +
          '</div>'; 
  } 
  document.getElementById('admin-users-list').innerHTML = h;
}

window.adminSaveUser = async function(userId) { 
  const nu = document.getElementById("admin-u-" + userId).value; 
  const np = document.getElementById("admin-p-" + userId).value; 
  const nr = document.getElementById("admin-r-" + userId).value;
  if(!nu || !np) { showToast("Fields cannot be empty."); return; } 
  loading(true, "Saving securely...");
  try {
     const res = await api.adminUpdateUser(currentUser, userId, nu, np, nr);
     loading(false); 
     if(res.error) showToast(res.message); 
     else showToast("User successfully updated!"); 
  } catch(e) { loading(false); showToast("Network error."); }
}

window.adminDeleteUserTrigger = async function(userId, username) {
  if(confirm("ADMIN: Are you absolutely sure you want to permanently delete " + username + "? This cannot be undone.")) {
    loading(true, "Terminating user...");
    try {
        const res = await api.adminDeleteUser(currentUser, userId);
        loading(false);
        if(res.error) showToast(res.message);
        else { showToast(res.message); openAdminDashboard(); syncData(); }
    } catch(e) { loading(false); showToast("Network error."); }
  }
}

window.setFeedScope = function(scope) {
  feedScopeMode = scope;
  document.getElementById('btn-feed-global').classList.remove('active');
  document.getElementById('btn-feed-friends').classList.remove('active');
  document.getElementById('btn-feed-' + scope).classList.add('active');
  renderFeed();
}

window.setFilter = function(filterType, el) { 
  currentFilter = filterType; 
  const chips = document.querySelectorAll('.room-chip'); 
  for(let i=0; i<chips.length; i++) chips[i].classList.remove('active');
  el.classList.add('active'); 
  applyRoomVibe(filterType); 
  renderFeed(); 
}

function doDoubleTapLike(postId, rowNum, e) { 
  const heart = document.createElement('div'); 
  heart.innerHTML = '❤️';
  heart.className = 'floating-heart'; 
  heart.style.left = (e.clientX - 25) + 'px'; 
  heart.style.top = (e.clientY - 40) + 'px'; 
  document.body.appendChild(heart);
  setTimeout(() => { heart.remove(); }, 1000); 
  setReact(postId, rowNum, '❤️'); 
}

window.openEditPost = function(postId, rowNum) {
  const post = db.posts.find(p => p.postId === postId);
  if(!post) return;
  document.getElementById('edit-post-id').value = postId;
  document.getElementById('edit-post-rownum').value = rowNum;
  document.getElementById('edit-post-caption').value = post.caption || '';
  document.getElementById('edit-post-location').value = post.location || '';
  document.getElementById('edit-post-link').value = post.link || '';
  
  let catOpts = '';
  for(let i=0; i<db.categories.length; i++) {
     catOpts += '<option value="' + db.categories[i] + '" ' + (post.category===db.categories[i]?'selected':'') + '>' + db.categories[i] + '</option>';
  }
  document.getElementById('edit-post-category').innerHTML = catOpts;
  document.getElementById('edit-post-modal').classList.add('active');
  pushModalState('edit-post-modal');
}

window.closeEditPost = function() { document.getElementById('edit-post-modal').classList.remove('active'); }

window.saveEditedPost = async function() {
  const pId = document.getElementById('edit-post-id').value;
  const rNum = document.getElementById('edit-post-rownum').value;
  const payload = {
    caption: document.getElementById('edit-post-caption').value,
    category: document.getElementById('edit-post-category').value,
    location: document.getElementById('edit-post-location').value,
    link: document.getElementById('edit-post-link').value
  };
  loading(true, "Updating post...");
  try {
     const r = await api.editPostMetadata(pId, rNum, payload);
     processResponse(r, () => { closeEditPost(); renderFeed(); showToast("Post updated."); }); 
  } catch(e) { loading(false); showToast("Network error."); }
}

window.togglePin = async function(postId, rowNum) {
  if (currentRole !== 'admin') { 
    showToast("Only admins can pin announcements.");
    return; 
  }
  loading(true, "Updating pin status...");
  try {
      const r = await api.togglePin(postId, rowNum);
      processResponse(r, renderFeed); showToast("Pin status updated.");
  } catch(e) { loading(false); showToast("Network error."); }
}

window.adminDeletePost = async function(postId) {
  if(confirm("ADMIN ACTION: Obliterate this post entirely?")) {
    loading(true, "Deleting...");
    try {
        const res = await api.adminDeleteAnyPost(currentUser, postId);
        processResponse(res, renderFeed); showToast("Post annihilated.");
    } catch(e) { loading(false); showToast("Network error."); }
  }
}

function renderStoriesUI() { 
  const wrap = document.getElementById('stories-wrapper'); 
  const uPic = (db.profiles && db.profiles[currentUser] && db.profiles[currentUser].profilePic) ? '<img src="' + db.profiles[currentUser].profilePic + '">' : '<div class="avatar-placeholder">' + currentUser.charAt(0) + '</div>'; 
  let html = '<div class="story-bubble" onclick="document.getElementById(\'story-upload-input\').click();"><div class="story-ring seen">' + uPic + '<div class="add-story-btn">+</div></div><span class="story-author">Your Story</span></div>';
  
  const authorGroups = {}; 
  if(db.stories) { 
    for(let i=0; i<db.stories.length; i++) { 
      const s = db.stories[i]; 
      if(!authorGroups[s.author]) authorGroups[s.author] = []; 
      authorGroups[s.author].push(s);
    } 
  } 
  
  const authors = Object.keys(authorGroups); 
  for(let a=0; a<authors.length; a++) { 
    const aName = authors[a];
    const pic = (db.profiles && db.profiles[aName] && db.profiles[aName].profilePic) ? '<img src="' + db.profiles[aName].profilePic + '">' : '<div class="avatar-placeholder">' + aName.charAt(0) + '</div>';
    html += '<div class="story-bubble" onclick="playStories(\'' + aName + '\')"><div class="story-ring">' + pic + '</div><span class="story-author">' + aName + '</span></div>'; 
  } 
  wrap.innerHTML = html;
}

window.handleStoryUpload = function(e) { 
  const file = e.target.files[0]; 
  if(!file) return;
  if(file.size > 25*1024*1024) { showToast("Story file too large (>25MB)"); return; } 
  loading(true, "Uploading Story..."); 
  const reader = new FileReader();
  reader.onload = async function(evt) { 
    const payload = { 
      author: currentUser, base64Data: evt.target.result, fileName: file.name, 
      mimeType: file.type, mediaType: file.type.indexOf('video')!==-1 ? 'video' : 'image' 
    }; 
    try {
        const r = await api.uploadStory(payload);
        processResponse(r, () => { renderStoriesUI(); showToast("Story Added!"); }); 
    } catch(e) { loading(false); showToast("Upload error."); }
  }; 
  reader.readAsDataURL(file);
}

window.playStories = function(author) { 
  activeStoryQueue = []; 
  for(let i=0; i<db.stories.length; i++) { if(db.stories[i].author === author) activeStoryQueue.push(db.stories[i]); } 
  if(activeStoryQueue.length === 0) return; 
  activeStoryQueue.sort((a,b) => a.timestamp - b.timestamp); 
  currentStoryIndex = 0; 
  document.getElementById('story-viewer').classList.add('active');
  pushModalState('story-viewer');

  const pic = (db.profiles && db.profiles[author] && db.profiles[author].profilePic) ? '<img src="' + db.profiles[author].profilePic + '" style="width:100%; height:100%; object-fit:cover;">' : author.charAt(0); 
  document.getElementById('story-avatar').innerHTML = pic;
  document.getElementById('story-author-name').innerText = author; 
  
  if (author === currentUser) { document.getElementById('story-delete-btn').style.display = 'block'; }
  else { document.getElementById('story-delete-btn').style.display = 'none'; }
  
  renderCurrentStory(); 
}

window.triggerDeleteStory = async function() {
  if(currentStoryIndex < activeStoryQueue.length) {
     if(confirm("Delete this story?")) {
        const stId = activeStoryQueue[currentStoryIndex].storyId;
        closeStory();
        loading(true, "Deleting story...");
        try {
            const res = await api.deleteStory(stId, currentUser);
            processResponse(res, renderStoriesUI); showToast("Story deleted.");
        } catch(e) { loading(false); showToast("Error deleting story."); }
     }
  }
}

window.renderCurrentStory = function() { 
  clearTimeout(storyTimer); 
  const fill = document.getElementById('story-progress'); fill.style.transition = 'none'; fill.style.width = '0%'; 
  if(currentStoryIndex >= activeStoryQueue.length) { closeStory(); return; } 
  const st = activeStoryQueue[currentStoryIndex]; 
  const mc = document.getElementById('story-media-container'); 
  if(st.mediaType === 'video') { 
    mc.innerHTML = '<video src="' + st.mediaUrl + '" autoplay playsinline style="width:100%; height:100%; border:none;"></video>'; 
    storyTimer = setTimeout(nextStory, 15000); setTimeout(() => { fill.style.transition = 'width 15s linear'; fill.style.width = '100%'; }, 50); 
  } else { 
    mc.innerHTML = '<img src="' + st.mediaUrl + '" style="width:100%; height:100%; object-fit:contain;">';
    storyTimer = setTimeout(nextStory, 6000); setTimeout(() => { fill.style.transition = 'width 6s linear'; fill.style.width = '100%'; }, 50);
  } 
}

window.nextStory = function() { currentStoryIndex++; renderCurrentStory(); } 
window.prevStory = function() { currentStoryIndex--; if(currentStoryIndex < 0) currentStoryIndex = 0; renderCurrentStory(); } 
window.closeStory = function() { clearTimeout(storyTimer); document.getElementById('story-viewer').classList.remove('active'); document.getElementById('story-media-container').innerHTML = ''; }

window.handleFriendAction = async function(action, targetUser) {
    loading(true, "Updating network...");
    try {
        const res = await api.manageFriendRequest(action, currentUser, targetUser);
        processResponse(res, () => {
            openProfile(targetUser); 
            showToast("Network updated.");
            renderFeed();
        });
    } catch(e) { loading(false); showToast("Network error."); }
}

function generatePostHTML(post, isPreview) {
  let html = '';
  if(!post.likes) post.likes = [];
  const reactData = parseReactions(post.likes); 
  const reactIconMain = reactData.myReaction || '🤍';
  let isSaved = false;
  if(db.saves) { 
    for(let s=0; s<db.saves.length; s++) { if(db.saves[s].postId === post.postId && db.saves[s].user === currentUser) { isSaved=true; break; } } 
  }
  const saveIcon = isSaved ? '🔖' : '📑';
  const isSpark = post.mediaType === 'spark'; 
  
  const postStyleClass = post.style ? post.style : 'default-style';
  const postClass = isSpark ? 'post spark-post ' + postStyleClass : 'post ' + postStyleClass;
  
  let mHtml = '';

  if (isPreview && pendingUploadList.length > 0 && !isSpark) {
     mHtml += '<div class="media-carousel">';
     for(let m=0; m<pendingUploadList.length; m++) {
        if(pendingUploadList[m].mimeType.indexOf('video') !== -1) {
           mHtml += '<div class="media-container"><div style="color:#fff; z-index:5;">🎥 Local Video Preview</div></div>';
        } else {
           mHtml += '<div class="media-container"><div class="media-backdrop" style="background-image:url(\'' + pendingUploadList[m].base64Data + '\');"></div><img src="' + pendingUploadList[m].base64Data + '"></div>';
        }
     }
     mHtml += '</div>';
  } 
  else if (!isSpark && post.mediaUrl && post.mediaUrl.length > 5 && !isPreview) {
    let isArray = false;
    let mediaUrls = [];
    try { 
       const parsed = JSON.parse(post.mediaUrl);
       if (Array.isArray(parsed)) { isArray = true; mediaUrls = parsed; }
    } catch(e) {}
    
    if (isArray && mediaUrls.length > 1) {
       mHtml += '<div class="media-carousel">';
       for(let m=0; m<mediaUrls.length; m++) {
          mHtml += '<div class="media-container" onclick="customDoubleTap(\'' + post.postId + '\',' + post.rowNum + ', event)"><div class="carousel-indicator">' + (m+1) + '/' + mediaUrls.length + '</div><div class="media-backdrop" style="background-image:url(\'' + mediaUrls[m] + '\');"></div><img src="' + mediaUrls[m] + '" loading="lazy"></div>';
       }
       mHtml += '</div>';
    } else {
       const singleUrl = isArray ? mediaUrls[0] : post.mediaUrl;
       if (post.mediaType && post.mediaType.indexOf('video')!==-1) {
          mHtml = '<div class="media-container" onclick="customDoubleTap(\'' + post.postId + '\',' + post.rowNum + ', event)"><video src="' + singleUrl + '" controls style="width:100%; height:500px; position:relative; z-index:2;"></video></div>';
       } else {
          mHtml = '<div class="media-container" onclick="customDoubleTap(\'' + post.postId + '\',' + post.rowNum + ', event)"><div class="media-backdrop" style="background-image:url(\'' + singleUrl + '\');"></div><img src="' + singleUrl + '" loading="lazy"></div>';
       }
    }
  }

  let cCount = 0;
  if(db.comments && !isPreview) { for(let j=0; j<db.comments.length; j++) if(db.comments[j].postId===post.postId) cCount++; }
  
  const badgeColor = getRoomColor(post.category);
  let badgeHtml = '<span class="cat-badge" style="color:' + badgeColor + '; background:' + badgeColor + '15;">' + (isSpark ? "Spark 🔥" : post.category) + '</span>';
  if (post.isPinned && !isPreview) {
    badgeHtml += '<span class="cat-badge" style="margin-left:4px; color:#ef4444; background:rgba(239,68,68,0.15);">📌 Pinned</span>';
  }
  if (post.flair && post.flair !== 'General') {
    const flairColors = { 'Announce': '#FF5722', 'Thought': '#3b82f6', 'Question': '#eab308', 'Chill': '#10b981' };
    const fColor = flairColors[post.flair] || 'var(--accent)';
    badgeHtml += '<span class="cat-badge" style="margin-left:4px; color:#fff; background:' + fColor + ';">' + post.flair + '</span>';
  }
  
  const authorBadges = (db.profiles && db.profiles[post.author]) ? db.profiles[post.author].badges : [];
  const extraStyle = isPreview ? 'margin-bottom:0; border-bottom:none;' : '';

  html += '<div class="' + postClass + '" id="post-' + post.postId + '" style="' + extraStyle + '">';
  html += '<div class="post-header">';
  html += '<div style="display:flex; gap:12px;">';
  html += getAvatarHtml(post.author);
  html += '<div><p class="post-author" onclick="' + (isPreview?'':'openProfile(\'' + post.author + '\')') + '">' + post.author + getBadgeHtml(authorBadges) + '</p>' + badgeHtml + '</div>';
  html += '</div>';
  html += '<div style="display:flex; align-items:center; gap:8px;">';
  html += '<span class="post-time">' + post.dateStr + '</span>';
  
  if (!isPreview) {
     if (post.author === currentUser) {
       html += '<span class="action-btn" style="color:var(--text-sub); font-size:18px; margin-left:8px;" onclick="openEditPost(\'' + post.postId + '\',' + post.rowNum + ')">✏️</span>';
       html += '<span class="action-btn" style="color:var(--text-sub); font-size:18px; margin-left:8px;" onclick="deletePost(\'' + post.postId + '\',' + post.rowNum + ')">🗑️</span>';
     } else if (currentRole === 'admin') {
       html += '<span class="action-btn" style="color:#ef4444; font-size:18px; margin-left:8px;" onclick="adminDeletePost(\'' + post.postId + '\')">🗑️</span>';
     }
     if (currentRole === 'admin') {
       html += '<span class="action-btn" style="color:var(--text-sub); font-size:18px; margin-left:8px;" onclick="togglePin(\'' + post.postId + '\',' + post.rowNum + ')">📌</span>';
     }
  }
  html += '</div></div>';
  
  if (mHtml) html += mHtml;
  if (!isSpark && post.link && post.link.length>5) html += '<div class="link-card" onclick="window.open(\'' + post.link + '\')"><span style="font-size:18px;">🔗</span> <span style="font-weight:700; color:var(--primary);">View Linked Content</span></div>';
  if (isSpark && post.caption) html += '<div class="post-caption" onclick="' + (isPreview?'':'customDoubleTap(\'' + post.postId + '\',' + post.rowNum + ', event)') + '">' + formatCaption(post.caption) + '</div>';

  html += '<div class="post-actions">';
  html += '<div class="action-group">';
  html += '<button class="action-btn" onclick="' + (isPreview?'':'toggleReactionMenu(\'' + post.postId + '\')') + '">' + reactIconMain + '</button>';
  
  if(!isPreview) {
     html += '<div class="reaction-popover" id="react-menu-' + post.postId + '">';
     html += '<span class="react-icon" onclick="setReact(\'' + post.postId + '\',' + post.rowNum + ',\'❤️\')">❤️</span>';
     html += '<span class="react-icon" onclick="setReact(\'' + post.postId + '\',' + post.rowNum + ',\'😂\')">😂</span>';
     html += '<span class="react-icon" onclick="setReact(\'' + post.postId + '\',' + post.rowNum + ',\'👍\')">👍</span>';
     html += '<span class="react-icon" onclick="setReact(\'' + post.postId + '\',' + post.rowNum + ',\'😮\')">😮</span>';
     if (reactData.myReaction) html += '<span class="react-icon" onclick="setReact(\'' + post.postId + '\',' + post.rowNum + ',\'remove\')">❌</span>';
     html += '</div>';
  }
  
  html += '<button class="action-btn" onclick="' + (isPreview?'':'openComments(\'' + post.postId + '\')') + '">💬</button>';
  html += '<button class="action-btn" onclick="' + (isPreview?'':'sharePost(\'' + post.author + '\',\'' + post.caption.replace(/'/g, "\\'") + '\')') + '">↩️</button>';
  html += '</div>';
  html += '<button class="action-btn" onclick="' + (isPreview?'':'toggleSave(\'' + post.postId + '\')') + '">' + saveIcon + '</button>';
  html += '</div>';
  
  if(!isPreview) html += '<div class="post-likes">' + generateReactionsText(reactData) + '</div>';
  if (!isSpark && post.caption) html += '<div class="post-caption" onclick="' + (isPreview?'':'customDoubleTap(\'' + post.postId + '\',' + post.rowNum + ', event)') + '"><span class="author" onclick="' + (isPreview?'':'openProfile(\'' + post.author + '\')') + '">' + post.author + '</span> ' + formatCaption(post.caption) + '</div>';
  if (cCount > 0) html += '<div style="padding:0 16px; margin-top:8px; font-size:14px; color:var(--text-sub); cursor:pointer; font-weight:500;" onclick="openComments(\'' + post.postId + '\')">View ' + cCount + ' comments</div>';
  html += '</div>';

  return html;
}

function renderFeed() {
  const c = document.getElementById('posts-wrapper');
  const now = new Date().getTime(); 
  const filteredPosts = [];

  for(let x=0; x<db.posts.length; x++) {
    const p = db.posts[x];
    let keep = true;
    
    if(currentFilter === '24h' && (now - p.timestamp) > 86400000) keep = false;
    else if(currentFilter !== 'All' && currentFilter !== '24h' && p.category !== currentFilter) keep = false;

    if (keep && feedScopeMode === 'friends' && p.author !== currentUser) {
        if (!db.friendData || !db.friendData.friends || db.friendData.friends.indexOf(p.author) === -1) {
            keep = false;
        }
    }
    if(keep) filteredPosts.push(p);
  }
  
  filteredPosts.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.timestamp - a.timestamp;
  });
  
  if (filteredPosts.length === 0) { 
    c.innerHTML = '<div style="text-align:center; padding: 60px 20px; color:var(--text-sub); font-size:15px; font-weight:600;">No posts found here.<br><span style="font-size:36px; display:block; margin-top:16px;">🏕️</span></div>';
    return; 
  }

  let html = '';
  for (let i=0; i<filteredPosts.length; i++) {
     html += generatePostHTML(filteredPosts[i], false);
  }
  c.innerHTML = html;
}

window.renderPostPreview = function() {
   const cap = document.getElementById('post-caption').value;
   const cat = document.getElementById('post-category').value; 
   const loc = document.getElementById('post-location').value; 
   const isSpark = document.getElementById('is-spark').checked;
   const pFlair = document.getElementById('post-flair') ? document.getElementById('post-flair').value : 'General';
   const pStyle = document.getElementById('post-style') ? document.getElementById('post-style').value : 'default-style';
   const container = document.getElementById('live-post-preview');

   const dummyPost = {
      postId: 'preview', author: currentUser, timestamp: new Date().getTime(), dateStr: 'Just now',
      caption: cap, category: cat || 'General', location: loc, link: '',
      mediaType: isSpark ? 'spark' : 'image', flair: pFlair, style: pStyle, likes: [], isPinned: false, mediaUrl: ''
   };

   const html = generatePostHTML(dummyPost, true);
   container.innerHTML = html;
   container.style.display = 'block';
}

window.openProfile = function(username) { 
  document.getElementById('user-dropdown').classList.remove('active');
  loading(true, "Loading profile...");
  
  setTimeout(() => {
      const prof = (db.profiles && db.profiles[username]) ? db.profiles[username] : {bio: "", profilePic: "", location: "", website: "", pronouns: "", badges: []};
      const uPosts = db.posts.filter(p => p.author === username); 
      
      let friendBtnHtml = '';
      let fCount = 0;
      if(db.friendData && username === currentUser) { fCount = db.friendData.friends.length; } 

      if(username !== currentUser && db.friendData) {
          const fData = db.friendData;
          if(fData.friends.indexOf(username) !== -1) {
              friendBtnHtml = '<button class="btn-small" style="background:var(--surface); border:1px solid #10b981; color:#10b981;" onclick="handleFriendAction(\'unfriend\', \'' + username + '\')">Friends ✓</button>';
          } else if (fData.pendingSent.indexOf(username) !== -1) {
              friendBtnHtml = '<button class="btn-small" style="background:var(--surface); border:1px solid var(--text-sub); color:var(--text-sub);" onclick="handleFriendAction(\'cancel\', \'' + username + '\')">Cancel Request</button>';
          } else if (fData.pendingReceived.indexOf(username) !== -1) {
              friendBtnHtml = '<div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">' +
                              '<button class="btn-small" style="background:#10b981; color:#fff; border:none;" onclick="handleFriendAction(\'accept\', \'' + username + '\')">Accept</button>' +
                              '<button class="btn-small" style="background:#ef4444; color:#fff; border:none;" onclick="handleFriendAction(\'decline\', \'' + username + '\')">Decline</button>' +
                              '</div>';
          } else {
              friendBtnHtml = '<button class="btn-small" style="background:var(--accent); color:#fff; border:none;" onclick="handleFriendAction(\'send\', \'' + username + '\')">Add Friend</button>';
          }
      }

      let h = '<div class="profile-header">';
      h += getAvatarHtml(username, "profile-avatar");
      h += '<h2 class="profile-name">' + username + getBadgeHtml(prof.badges) + '</h2>';
      
      if(prof.pronouns || prof.location || prof.website) {
         h += '<div class="profile-meta-tags">';
         if(prof.pronouns) h += '<span class="meta-tag">' + prof.pronouns + '</span>';
         if(prof.location) h += '<span class="meta-tag">📍 ' + prof.location + '</span>';
         if(prof.website) h += '<span class="meta-tag" style="cursor:pointer; color:var(--accent);" onclick="window.open(\'' + prof.website + '\')">🔗 Link</span>';
         h += '</div>';
      }

      if(prof.bio) h += '<p class="profile-bio">' + formatCaption(prof.bio) + '</p>'; 
      h += '<div class="profile-stats"><div class="stat-box"><span class="stat-num">' + uPosts.length + '</span><span class="stat-label">Posts</span></div>';
      if(username === currentUser) h += '<div class="stat-box"><span class="stat-num">' + fCount + '</span><span class="stat-label">Friends</span></div>';
      h += '</div>';
      
      if(username === currentUser) {
        h += '<button class="btn-small" onclick="openEditProfile()">Edit Profile</button>';
      } else {
        h += friendBtnHtml;
      }
      
      h += '</div><div class="prof-tabs">';
      h += '<div class="prof-tab active" id="tab-posts" onclick="switchProfTab(\'posts\')">Posts</div>';
      if(username === currentUser) {
         h += '<div class="prof-tab" id="tab-saved" onclick="switchProfTab(\'saved\')">Saved</div>'; 
         h += '<div class="prof-tab" id="tab-network" onclick="switchProfTab(\'network\')">Network</div>';
      }
      h += '</div><div id="prof-grid-posts" class="profile-grid">';
      
      for(let i=0; i<uPosts.length; i++) { 
        const p = uPosts[i]; 
        let dispUrl = "";
        if(p.mediaUrl && p.mediaUrl.length > 5 && p.mediaType !== 'spark') {
           try { const parsed = JSON.parse(p.mediaUrl); dispUrl = Array.isArray(parsed) ? parsed[0] : p.mediaUrl; } catch(e) { dispUrl = p.mediaUrl; }
           h += '<div class="grid-item" onclick="navTo(\'feed\'); setTimeout(function(){ document.getElementById(\'post-' + p.postId + '\').scrollIntoView(); }, 100);"><img src="' + dispUrl + '" loading="lazy"></div>';
        } else {
          h += '<div class="grid-item" style="display:flex; align-items:center; justify-content:center; padding:10px; font-size:11px; font-weight:700; text-align:center; color:var(--text-sub); background: ' + (p.mediaType==='spark'?'var(--border)':'var(--surface)') + ';" onclick="navTo(\'feed\'); setTimeout(function(){ document.getElementById(\'post-' + p.postId + '\').scrollIntoView(); }, 100);">' + (p.caption ? p.caption.substring(0,40)+'...' : 'Text') + '</div>'; 
        }
      } 
      h += '</div>';
      
      if(username === currentUser) { 
        h += '<div id="prof-grid-saved" class="profile-grid" style="display:none;">';
        if(db.saves) { 
          for(let s=0; s<db.saves.length; s++) { 
            if(db.saves[s].user !== currentUser) continue; 
            const sId = db.saves[s].postId;
            for(let j=0; j<db.posts.length; j++) { 
              if(db.posts[j].postId === sId) { 
                let sDisp = "";
                if(db.posts[j].mediaUrl && db.posts[j].mediaUrl.length>5 && db.posts[j].mediaType !== 'spark') {
                  try { const sParsed = JSON.parse(db.posts[j].mediaUrl); sDisp = Array.isArray(sParsed) ? sParsed[0] : db.posts[j].mediaUrl; } catch(e) { sDisp = db.posts[j].mediaUrl; }
                  h += '<div class="grid-item" onclick="navTo(\'feed\'); setTimeout(function(){ document.getElementById(\'post-' + sId + '\').scrollIntoView(); }, 100);"><img src="' + sDisp + '"></div>';
                } else {
                  h += '<div class="grid-item" style="display:flex; align-items:center; justify-content:center; padding:10px; font-size:11px; font-weight:700; text-align:center; color:var(--text-sub);" onclick="navTo(\'feed\'); setTimeout(function(){ document.getElementById(\'post-' + sId + '\').scrollIntoView(); }, 100);">' + (db.posts[j].caption ? db.posts[j].caption.substring(0,40)+'...' : 'Text') + '</div>'; 
                }
              } 
            } 
          } 
        } 
        h += '</div>';
        
        h += '<div id="prof-grid-network" style="display:none; padding:16px;">';
        if(db.friendData) {
           const fd = db.friendData;
           if(fd.pendingReceived.length > 0) {
              h += '<h3 style="font-size:14px; color:var(--primary); margin-top:0;">Pending Requests</h3>';
              for(let pr=0; pr<fd.pendingReceived.length; pr++) {
                 h += '<div class="friend-list-item"><div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="openProfile(\'' + fd.pendingReceived[pr] + '\')">' + getAvatarHtml(fd.pendingReceived[pr]) + '<strong style="color:var(--primary);">' + fd.pendingReceived[pr] + '</strong></div>';
                 h += '<div style="display:flex; gap:8px;"><button class="btn-small" style="background:#10b981; color:#fff; border:none; padding:6px 12px;" onclick="handleFriendAction(\'accept\', \'' + fd.pendingReceived[pr] + '\')">Accept</button></div></div>';
              }
           }
           h += '<h3 style="font-size:14px; color:var(--primary); margin-top:20px;">My Friends (' + fd.friends.length + ')</h3>';
           if(fd.friends.length === 0) h += '<p style="color:var(--text-sub); font-size:13px;">No friends yet. Start connecting!</p>';
           for(let fr=0; fr<fd.friends.length; fr++) {
               h += '<div class="friend-list-item"><div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="openProfile(\'' + fd.friends[fr] + '\')">' + getAvatarHtml(fd.friends[fr]) + '<strong style="color:var(--primary);">' + fd.friends[fr] + '</strong></div>';
               h += '<button class="btn-small" style="background:var(--surface); color:var(--text-sub); padding:6px 12px;" onclick="handleFriendAction(\'unfriend\', \'' + fd.friends[fr] + '\')">Remove</button></div>';
           }
        }
        h += '</div>';
      } 
      document.getElementById('profile-content').innerHTML = h; 
      navTo('profile'); 
      loading(false);
  }, 50);
}

window.switchProfTab = function(tab) { 
  document.getElementById('tab-posts').classList.remove('active'); 
  if(document.getElementById('tab-saved')) document.getElementById('tab-saved').classList.remove('active'); 
  if(document.getElementById('tab-network')) document.getElementById('tab-network').classList.remove('active');
  
  document.getElementById('tab-'+tab).classList.add('active'); 
  document.getElementById('prof-grid-posts').style.display = 'none';
  if(document.getElementById('prof-grid-saved')) document.getElementById('prof-grid-saved').style.display = 'none'; 
  if(document.getElementById('prof-grid-network')) document.getElementById('prof-grid-network').style.display = 'none'; 
  
  const target = document.getElementById('prof-grid-'+tab);
  if(target) { target.style.display = (tab === 'network') ? 'block' : 'grid'; }
}

window.handleProfFileSelect = function(e) { 
  const file = e.target.files[0]; 
  if(!file) return;
  const reader = new FileReader(); 
  reader.onload = function(evt) { 
    document.getElementById('prof-upload-label').style.display = 'none';
    
    const cropCont = document.getElementById('crop-modal-container');
    const img = document.getElementById('crop-image');
    
    cropCont.style.display = 'block'; 
    img.src = evt.target.result;
    
    if(cropperInstance) cropperInstance.destroy();
    cropperInstance = new Cropper(img, { aspectRatio: 1, viewMode: 1, autoCropArea: 1 });
    
    pendingProfUpload.fileName = file.name; 
    pendingProfUpload.mimeType = 'image/jpeg';
    document.getElementById('apply-crop-btn').style.display = 'block';
  }; 
  reader.readAsDataURL(file);
}

window.finalizeCrop = function() {
   if(!cropperInstance) return;
   const canvas = cropperInstance.getCroppedCanvas({width: 400, height: 400});
   pendingProfUpload.base64Data = canvas.toDataURL('image/jpeg', 0.7); 
   
   cropperInstance.destroy(); 
   cropperInstance = null;
   
   document.getElementById('crop-modal-container').style.display = 'none';
   document.getElementById('apply-crop-btn').style.display = 'none';
   
   const label = document.getElementById('prof-upload-label');
   label.style.display = 'flex'; 
   label.style.border = 'none';
   
   document.getElementById('prof-picker-text').style.display = 'none'; 
   document.getElementById('prof-preview-img').src = pendingProfUpload.base64Data; 
   document.getElementById('prof-preview-img').style.display = 'block'; 
}

window.openEditProfile = function() { 
  const prof = (db.profiles && db.profiles[currentUser]) ? db.profiles[currentUser] : {};
  document.getElementById('edit-bio').value = prof.bio || ''; 
  document.getElementById('edit-location').value = prof.location || ''; 
  document.getElementById('edit-website').value = prof.website || ''; 
  document.getElementById('edit-pronouns').value = prof.pronouns || ''; 
  document.getElementById('edit-hide-search').checked = prof.hideFromSearch ? true : false;
  
  document.getElementById('prof-picker-text').style.display = 'block'; 
  document.getElementById('prof-preview-img').style.display = 'none';
  document.getElementById('prof-upload-label').style.display = 'flex'; 
  document.getElementById('prof-upload-label').style.border = '2px dashed var(--border)';
  
  if(cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  document.getElementById('crop-modal-container').style.display = 'none';
  document.getElementById('apply-crop-btn').style.display = 'none';

  pendingProfUpload = { base64Data: null, fileName: null, mimeType: null }; 
  document.getElementById('edit-profile-modal').classList.add('active'); 
  pushModalState('edit-profile-modal');
}

window.closeEditProfile = function() { document.getElementById('edit-profile-modal').classList.remove('active'); }

window.saveProfile = async function() { 
  const payload = {
     bio: document.getElementById('edit-bio').value,
     location: document.getElementById('edit-location').value,
     website: document.getElementById('edit-website').value,
     pronouns: document.getElementById('edit-pronouns').value,
     hideFromSearch: document.getElementById('edit-hide-search').checked,
     base64Data: pendingProfUpload.base64Data,
     fileName: pendingProfUpload.fileName,
     mimeType: pendingProfUpload.mimeType
  };
  loading(true, "Updating Profile...");
  try {
      const r = await api.updateProfile(currentUser, payload);
      processResponse(r, () => { closeEditProfile(); openProfile(currentUser); renderFeed(); showToast("Profile Updated!"); }); 
  } catch(e) { loading(false); showToast("Upload error."); }
}

window.toggleReactionMenu = function(postId) { 
  const menus = document.querySelectorAll('.reaction-popover'); 
  for(let i=0; i<menus.length; i++) { if(menus[i].id !== 'react-menu-'+postId) menus[i].classList.remove('active'); } 
  const m = document.getElementById('react-menu-'+postId); 
  if(m) m.classList.toggle('active'); 
}

window.setReact = async function(postId, rowNum, type) { 
  document.getElementById('react-menu-'+postId).classList.remove('active');
  let post = null; 
  for(let i=0; i<db.posts.length; i++) { if(db.posts[i].postId === postId) post = db.posts[i]; }
  if(!post) return; 
  const newLikes = [];
  for(let j=0; j<post.likes.length; j++) { if(post.likes[j].split('|')[0] !== currentUser) newLikes.push(post.likes[j]); } 
  if(type !== 'remove') newLikes.push(currentUser + "|" + type);
  post.likes = newLikes; 
  renderFeed(); 
  try {
      const r = await api.toggleReaction(postId, rowNum, currentUser, type);
      if(!r.error) db = r;
  } catch(e) {}
}

window.toggleSave = async function(postId) { 
  let isSaved = false; const newSaves = []; 
  for(let i=0; i<db.saves.length; i++) { 
    if(db.saves[i].postId === postId && db.saves[i].user === currentUser) isSaved=true; 
    else newSaves.push(db.saves[i]);
  } 
  if(!isSaved) newSaves.push({postId: postId, user: currentUser}); 
  db.saves = newSaves; 
  renderFeed(); showToast(isSaved ? "Removed from Saved" : "Saved to Profile 🔖");
  try {
      const r = await api.toggleSave(postId, currentUser);
      if(!r.error) db = r;
  } catch(e) {}
}

window.sharePost = function(author, text) { 
  if (navigator.share) { navigator.share({ title: "Fireside Post by " + author, text: text }).catch(e=>{});
  } else { showToast("Native sharing not supported here."); } 
}

window.deletePost = async function(postId, rowNum) { 
  if(confirm("Delete this post?")) { 
    loading(true, "Deleting...");
    try {
        const r = await api.deletePost(postId, rowNum);
        processResponse(r, renderFeed); showToast("Deleted."); 
    } catch(e) { loading(false); showToast("Network error."); }
  } 
}

window.handleMultiFileSelect = function(e) { 
  const files = e.target.files; 
  if(!files || files.length === 0) return;
  document.getElementById('picker-text').style.display = 'none';
  const previewBar = document.getElementById('upload-preview-bar');
  previewBar.style.display = 'flex';
  
  for(let i=0; i<files.length; i++) {
     const file = files[i];
     if(file.size > 25*1024*1024) { showToast("A file is too large (>25MB). Skipped."); continue; }
     
     const reader = new FileReader();
     reader.onload = (function(f) {
         return function(evt) {
             pendingUploadList.push({
                 base64Data: evt.target.result, fileName: f.name, mimeType: f.type
             });
             if(f.type.indexOf('image') !== -1) {
                 const img = document.createElement('img');
                 img.src = evt.target.result;
                 previewBar.appendChild(img);
             } else {
                 const vid = document.createElement('div');
                 vid.style.width = '80px'; vid.style.height = '100px'; vid.style.background = '#444'; vid.style.color = '#fff'; vid.style.display = 'flex'; vid.style.alignItems = 'center'; vid.style.justifyContent = 'center'; vid.style.borderRadius = '8px'; vid.innerText = '🎥';
                 previewBar.appendChild(vid);
             }
         };
     })(file);
     reader.readAsDataURL(file);
  }
}

window.toggleSparkMode = function(checkbox) { 
  if(checkbox.checked) { 
    document.getElementById('upload-file-picker').style.display = 'none'; document.getElementById('upload-extra-group').style.display = 'none';
    document.getElementById('post-caption').placeholder = "Ignite a spark... (max 300 characters)"; 
  } else { 
    document.getElementById('upload-file-picker').style.display = 'flex'; document.getElementById('upload-extra-group').style.display = 'flex';
    document.getElementById('post-caption').placeholder = "Write a caption... (use @username to mention)"; 
  } 
}

window.submitPost = async function() { 
  const cap = document.getElementById('post-caption').value;
  const cat = document.getElementById('post-category').value; 
  const loc = document.getElementById('post-location').value; 
  const lnk = document.getElementById('post-link').value; 
  const isSpark = document.getElementById('is-spark').checked;
  const pFlair = document.getElementById('post-flair') ? document.getElementById('post-flair').value : 'General';
  const pStyle = document.getElementById('post-style') ? document.getElementById('post-style').value : 'default-style';

  if(isSpark && cap.length > 300) { showToast("Sparks max 300 chars."); return; } 
  if(!cap && pendingUploadList.length === 0 && !lnk) { showToast("Add a photo, video, or caption."); return; } 
  loading(true, "Igniting... 🔥");
  
  const pType = isSpark ? 'spark' : (pendingUploadList.length > 0 && pendingUploadList[0].mimeType.indexOf('video')!==-1 ? 'video' : 'image');
  const payload = { 
    author: currentUser, caption: cap, category: cat, location: loc, link: lnk, 
    mediaList: pendingUploadList, mediaType: pType, flair: pFlair, style: pStyle
  };
  
  try {
    const r = await api.createPost(payload);
    processResponse(r, () => { 
      pendingUploadList = []; 
      document.getElementById('post-caption').value=''; document.getElementById('post-location').value=''; document.getElementById('post-link').value=''; 
      const previewBar = document.getElementById('upload-preview-bar');
      previewBar.innerHTML = ''; previewBar.style.display = 'none';
      document.getElementById('picker-text').style.display='block'; 
      document.getElementById('is-spark').checked = false; toggleSparkMode(document.getElementById('is-spark')); 
      document.getElementById('live-post-preview').style.display = 'none';
      navTo('feed', document.querySelectorAll('.bottom-nav .nav-item')[0]); 
      renderFeed(); showToast(isSpark ? "Spark Ignited! 🔥" : "Posted to Fireside! 🚀"); 
    }); 
  } catch(e) { loading(false); showToast("Error uploading post."); }
}

function checkNotifications() { 
  const notifs = buildNotificationList(); 
  if (notifs.length > 0) { document.getElementById('bell-dot').style.display = 'block'; } 
}

window.clearBell = function() { document.getElementById('bell-dot').style.display = 'none'; }

window.clearMyNotifications = async function() {
    loading(true, "Clearing Activity...");
    try {
        const res = await api.clearNotifications(currentUser);
        if(res.error) { loading(false); showToast(res.message); }
        else { 
            if(db.profiles[currentUser]) db.profiles[currentUser].notifClearTime = Date.now();
            renderNotifications(); clearBell();
            loading(false); showToast("Cleared.");
        }
    } catch(e) { loading(false); showToast("Network error."); }
}

function buildNotificationList() {
  const notifs = [];
  const clearTime = (db.profiles && db.profiles[currentUser] && db.profiles[currentUser].notifClearTime) ? db.profiles[currentUser].notifClearTime : 0;
  
  if(db.comments) { 
    for(let i=0; i<db.comments.length; i++) { 
      const c = db.comments[i];
      if(c.author === currentUser || c.timestamp <= clearTime) continue; 
      if (c.text && c.text.indexOf('@' + currentUser) !== -1) { 
        notifs.push({ time: c.timestamp, html: '<div class="notif-item"><span class="notif-icon">📣</span><div><div class="notif-text"><strong>' + c.author + '</strong> mentioned you in a comment.</div><span class="notif-time">' + timeAgo(c.timestamp) + '</span></div></div>' });
      }
      for(let j=0; j<db.posts.length; j++) { 
        if(db.posts[j].postId === c.postId && db.posts[j].author === currentUser) { 
          notifs.push({ time: c.timestamp, html: '<div class="notif-item"><span class="notif-icon">💬</span><div><div class="notif-text"><strong>' + c.author + '</strong> commented on your post: "' + c.text + '"</div><span class="notif-time">' + timeAgo(c.timestamp) + '</span></div></div>' });
        } 
      } 
    } 
  } 
  for(let p=0; p<db.posts.length; p++) { 
    const post = db.posts[p];
    if(post.author !== currentUser && post.timestamp > clearTime && post.caption && post.caption.indexOf('@' + currentUser) !== -1) { 
      notifs.push({ time: post.timestamp, html: '<div class="notif-item"><span class="notif-icon">📣</span><div><div class="notif-text"><strong>' + post.author + '</strong> mentioned you in a post.</div><span class="notif-time">' + timeAgo(post.timestamp) + '</span></div></div>' });
    }
    if(post.author !== currentUser || !post.likes) continue;
    for(let l=0; l<post.likes.length; l++) { 
      const parts = post.likes[l].split('|'); const u = parts[0], r = parts[1] || '❤️';
      if(u !== currentUser && post.timestamp > clearTime) { 
        notifs.push({ time: post.timestamp + 1000, html: '<div class="notif-item"><span class="notif-icon">' + r + '</span><div><div class="notif-text"><strong>' + u + '</strong> reacted to your post.</div><span class="notif-time">Recently</span></div></div>' });
      } 
    } 
  } 
  return notifs;
}

function renderNotifications() { 
  const wrap = document.getElementById('notif-wrapper'); 
  const notifs = buildNotificationList();
  notifs.sort((a,b) => b.time - a.time); 
  if(notifs.length === 0) wrap.innerHTML = '<div style="padding:40px 20px; color:var(--text-sub); text-align:center; font-weight:600;">All caught up!</div>';
  else { 
    let nHtml = ''; for(let n=0; n<notifs.length; n++) nHtml += notifs[n].html; wrap.innerHTML = nHtml;
  } 
}

window.openComments = function(postId) { 
  document.getElementById('active-post-id').value = postId; 
  document.getElementById('comments-modal').classList.add('active'); 
  pushModalState('comments-modal');
  renderComments(postId);
}

window.closeComments = function() { document.getElementById('comments-modal').classList.remove('active'); }

window.deleteCommentTrigger = async function(commentId, postId) {
  if(confirm("ADMIN: Permanently delete this comment?")) {
    loading(true, "Deleting comment...");
    try {
        const res = await api.adminDeleteComment(currentUser, commentId);
        processResponse(res, () => { renderComments(postId); renderFeed(); });
    } catch(e) { loading(false); showToast("Network error."); }
  }
}

function renderComments(postId) { 
  const c = document.getElementById('comments-list');
  const pComs = []; 
  if(db.comments) { for(let i=0; i<db.comments.length; i++) { if(db.comments[i].postId === postId) pComs.push(db.comments[i]); } } 
  if(pComs.length===0) { 
    c.innerHTML='<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:600;">Start the conversation.</div>'; return; 
  } 
  let h='';
  for(let j=0; j<pComs.length; j++) { 
    let delBtn = '';
    if(currentRole === 'admin') {
       delBtn = '<span style="color:#ef4444; float:right; cursor:pointer;" onclick="deleteCommentTrigger(\'' + pComs[j].commentId + '\', \'' + postId + '\')">🗑️</span>';
    }
    const authorBadges = (db.profiles && db.profiles[pComs[j].author]) ? db.profiles[pComs[j].author].badges : [];
    h += '<div style="margin-bottom:20px; font-size:15px; line-height:1.5;">' + delBtn + '<strong style="margin-right:4px; color:var(--primary); cursor:pointer;" onclick="openProfile(\'' + pComs[j].author + '\')">' + pComs[j].author + '</strong>' + getBadgeHtml(authorBadges) + '<span style="margin-left:6px;">' + formatCaption(pComs[j].text) + '</span><span style="display:block; font-size:12px; color:var(--text-sub); margin-top:4px; font-weight:500;">' + pComs[j].dateStr + '</span></div>';
  } 
  c.innerHTML = h; c.scrollTop = c.scrollHeight; 
}

window.submitComment = async function() { 
  const pId = document.getElementById('active-post-id').value;
  const txt = document.getElementById('comment-text').value; if(!txt.trim()) return; 
  document.getElementById('comment-text').value = ''; 
  if(!db.comments) db.comments = [];
  db.comments.push({ postId:pId, author:currentUser, text:txt, dateStr:"Just now", timestamp: Date.now() }); 
  renderComments(pId); renderFeed(); 
  try {
      const r = await api.addComment(pId, currentUser, txt);
      if(!r.error) db = r;
  } catch(e) {}
}
