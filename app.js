// app.js

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

// Ensure cloud API is loaded
const api = window.cloud;

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

// --- AUTHENTICATION (Modernized) ---
window.attemptLogin = async function() { 
  const u = document.getElementById('login-username').value; 
  const p = document.getElementById('login-password').value;
  if (!u || !p) { showToast("Credentials required."); return; } 
  
  loading(true, "Authenticating...");
  try {
    const res = await api.authenticateUser(u, p);
    loading(false);
    
    if (res.error) { 
      showToast(res.message); 
    } else { 
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
    loading(false);
    showToast("Server connection failed.");
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
    loading(false);
    showToast("Registration failed.");
  }
};

// --- DATA SYNCING (Modernized) ---
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
    loading(false);
    showToast("Network Error.");
  }
};

// --- POST CREATION (Modernized) ---
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
      document.getElementById('post-caption').value=''; 
      document.getElementById('post-location').value=''; 
      document.getElementById('post-link').value=''; 
      document.getElementById('upload-preview-bar').innerHTML = ''; 
      document.getElementById('upload-preview-bar').style.display = 'none';
      document.getElementById('picker-text').style.display='block'; 
      document.getElementById('is-spark').checked = false; 
      toggleSparkMode(document.getElementById('is-spark')); 
      document.getElementById('live-post-preview').style.display = 'none';
      navTo('feed', document.querySelectorAll('.bottom-nav .nav-item')[0]); 
      renderFeed(); 
      showToast(isSpark ? "Spark Ignited! 🔥" : "Posted to Fireside! 🚀"); 
    });
  } catch (err) {
    loading(false);
    showToast("Failed to post.");
  }
};

// --- GENERAL UTILITIES & RENDERERS ---
// Keep all your UI rendering functions here exactly as they were (renderFeed, generatePostHTML, toggleTheme, etc.)
// Just remember to convert any remaining google.script.run calls to `await api.functionName()` inside a try/catch block.

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
};

window.loading = function(show, msg) { 
  document.getElementById('loader-msg').innerText = msg || "Syncing..."; 
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
};

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
};

// ... include the rest of your DOM manipulation logic here (navTo, openProfile, handleMultiFileSelect, etc.)
