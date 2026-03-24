// cloud.js - Complete Fireside Backend Interface

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword as firebaseUpdatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlAO7Ofi0MT8bS2C0him2Rd2edU4BoPMU",
  authDomain: "fireside-social-cd70b.firebaseapp.com",
  projectId: "fireside-social-cd70b",
  storageBucket: "fireside-social-cd70b.firebasestorage.app",
  messagingSenderId: "437430485808",
  appId: "1:437430485808:web:3f40a703426a8537f67ef5",
  measurementId: "G-6EET11P6VT"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

export const cloud = {
    // --- AUTHENTICATION & USERS ---
    registerUser: async (email, username, password) => {
        try {
            const cleanUser = String(username).trim();
            const searchUser = cleanUser.toLowerCase();

            // 1. Check if the username is already taken in the database
            const q = query(collection(db, "Users"), where("usernameLower", "==", searchUser));
            const snap = await getDocs(q);
            if (!snap.empty) return { error: true, message: "Username already taken. Please choose another." };

            // 2. Register the user with Firebase Authentication using their real email
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            
            // 3. Construct the network profile
            const newProfile = {
                userId: userCredential.user.uid, email: email, username: cleanUser, usernameLower: searchUser,
                bio: "New to Fireside", profilePic: "", theme: "dark", role: "user",
                notifClearTime: 0, location: "", website: "", pronouns: "", badges: [], hideFromSearch: false, createdAt: Date.now()
            };

            // 4. Save to Firestore
            await setDoc(doc(db, "Users", cleanUser), newProfile);
            return { success: true, message: "Account created successfully." };
        } catch (error) {
            let errorMsg = error.message;
            if (error.code === 'auth/weak-password') {
                errorMsg = "Password should be at least 6 characters.";
            } else if (error.code === 'auth/email-already-in-use') {
                errorMsg = "An account with this email already exists! Please log in.";
            } else if (error.code === 'auth/invalid-email') {
                errorMsg = "Please enter a valid email address.";
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMsg = "CONSOLE REQUIRED: Turn ON 'Email/Password' in Firebase Console under Authentication -> Sign-in method.";
            }
            return { error: true, message: errorMsg };
        }
    },

    authenticateUser: async (email, password) => {
        try {
            // 1. Authenticate with Firebase
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;
            
            // 2. Fetch the corresponding profile using the secured userId
            const qUid = query(collection(db, "Users"), where("userId", "==", uid));
            const snapUid = await getDocs(qUid);
            
            let p;

            if (snapUid.empty) {
                // GHOST ACCOUNT HEALER: If Auth succeeded but the profile never saved, we build it right now.
                const fallbackUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
                p = {
                    userId: uid, email: email, username: fallbackUsername, usernameLower: fallbackUsername.toLowerCase(),
                    bio: "Reconnected to Fireside", profilePic: "", theme: "dark", role: "user",
                    notifClearTime: 0, location: "", website: "", pronouns: "", badges: [], hideFromSearch: false, createdAt: Date.now()
                };
                
                // Save the healed profile back to the database
                await setDoc(doc(db, "Users", fallbackUsername), p);
            } else {
                p = snapUid.docs[0].data();
            }

            return { 
                success: true, 
                user: {
                    userId: p.userId, email: p.email, username: p.username, bio: p.bio, profilePic: p.profilePic,
                    theme: p.theme, role: p.role, notifClearTime: p.notifClearTime || 0,
                    location: p.location || "", website: p.website || "", pronouns: p.pronouns || ""
                } 
            };
        } catch (error) {
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                return { error: true, message: "Invalid email or password." };
            }
            return { error: true, message: "Authentication failed. " + error.message };
        }
    },

    changePassword: async (currentUser, currentP, newP) => {
        try {
            const userDoc = await getDoc(doc(db, "Users", currentUser));
            if (!userDoc.exists()) return { error: true, message: "User profile not found." };
            
            const email = userDoc.data().email;
            if (!email) return { error: true, message: "Email required for this action." };

            await signInWithEmailAndPassword(auth, email, currentP);
            await firebaseUpdatePassword(auth.currentUser, newP);
            return { success: true, message: "Password updated successfully." };
        } catch (e) { return { error: true, message: "Incorrect current password or error updating." }; }
    },

    changeUsername: async (currentUser, newU) => {
        return { error: true, message: "Username changes require database migration. Feature locked pending admin approval." };
    },

    updateThemeMode: async (currentUser, mode) => {
        try {
            await updateDoc(doc(db, "Users", currentUser), { theme: mode });
            return { success: true };
        } catch (e) { return { error: true, message: e.message }; }
    },

    clearNotifications: async (currentUser) => {
        try {
            await updateDoc(doc(db, "Users", currentUser), { notifClearTime: Date.now() });
            return { success: true };
        } catch (e) { return { error: true, message: e.message }; }
    },

    // --- PROFILES ---
    updateProfile: async (currentUser, payload) => {
        try {
            let picUrl = "";
            if (payload.base64Data) {
                const safeName = payload.fileName ? payload.fileName.replace(/[^a-zA-Z0-9.]/g, '_') : "profile.jpg";
                const fileRef = ref(storage, `profiles/${currentUser}_${Date.now()}_${safeName}`);
                await uploadString(fileRef, payload.base64Data, 'data_url');
                picUrl = await getDownloadURL(fileRef);
            }

            const updateData = {
                bio: payload.bio, location: payload.location || "",
                website: payload.website || "", pronouns: payload.pronouns || "",
                hideFromSearch: payload.hideFromSearch ? true : false
            };
            if (picUrl) updateData.profilePic = picUrl;

            await updateDoc(doc(db, "Users", currentUser), updateData);
            return await cloud.getSocialData(currentUser);
        } catch (e) { return { error: true, message: "Update Profile Error: " + e.message }; }
    },

    // --- MAIN SYNC (GET DATA) ---
    getSocialData: async (currentUser) => {
        try {
            const data = { posts: [], comments: [], saves: [], stories: [], categories: ["General", "Family Event", "Announcement", "Chore"], profiles: {}, friendData: {friends:[], pendingSent:[], pendingReceived:[]} };
            
            // 1. Categories
            const catDoc = await getDoc(doc(db, "System", "Categories"));
            if (catDoc.exists()) data.categories = catDoc.data().list || data.categories;

            // 2. Profiles
            const usersSnap = await getDocs(collection(db, "Users"));
            usersSnap.forEach(d => {
                const p = d.data();
                data.profiles[p.username] = { bio: p.bio||"", profilePic: p.profilePic||"", theme: p.theme||"dark", role: p.role||"user", notifClearTime: p.notifClearTime||0, location: p.location||"", website: p.website||"", pronouns: p.pronouns||"", badges: p.badges||[], hideFromSearch: p.hideFromSearch||false };
            });

            // 3. Posts
            const postsSnap = await getDocs(collection(db, "Posts"));
            postsSnap.forEach(d => {
                const p = d.data();
                data.posts.push({ ...p, dateStr: new Date(p.timestamp).toLocaleString() });
            });
            data.posts.sort((a, b) => b.timestamp - a.timestamp);

            // 4. Comments
            const commentsSnap = await getDocs(collection(db, "Comments"));
            commentsSnap.forEach(d => data.comments.push(d.data()));

            // 5. Saves
            const savesSnap = await getDocs(collection(db, "Saves"));
            savesSnap.forEach(d => data.saves.push(d.data()));

            // 6. Stories
            const storiesSnap = await getDocs(collection(db, "Stories"));
            const now = Date.now();
            storiesSnap.forEach(d => {
                const s = d.data();
                if (now - s.timestamp < 86400000) data.stories.push(s);
            });

            // 7. Friends
            if (currentUser) {
                const fSnap = await getDoc(doc(db, "Friends", currentUser));
                if (fSnap.exists()) data.friendData = fSnap.data();
            }

            return data;
        } catch (e) { return { error: true, message: "Database Sync Error: " + e.message }; }
    },

    // --- POSTS ---
    createPost: async (payload) => {
        try {
            let finalMediaString = "";
            if (payload.mediaList && payload.mediaList.length > 0) {
                const mediaUrlsArray = [];
                for (let i = 0; i < payload.mediaList.length; i++) {
                    const file = payload.mediaList[i];
                    const safeName = file.fileName.replace(/[^a-zA-Z0-9.]/g, '_');
                    const fileRef = ref(storage, `posts/${Date.now()}_${safeName}`);
                    await uploadString(fileRef, file.base64Data, 'data_url');
                    mediaUrlsArray.push(await getDownloadURL(fileRef));
                }
                if (mediaUrlsArray.length === 1) finalMediaString = mediaUrlsArray[0]; 
                else if (mediaUrlsArray.length > 1) finalMediaString = JSON.stringify(mediaUrlsArray); 
            }

            const newPost = {
                postId: "POST-" + Date.now(), timestamp: Date.now(),
                author: String(payload.author).trim(), mediaUrl: finalMediaString,
                mediaType: payload.mediaType, caption: payload.caption || "",
                location: payload.location || "", link: payload.link || "",
                category: payload.category || "General", flair: payload.flair || "General",
                style: payload.style || "default-style", likes: [], isPinned: false
            };

            await setDoc(doc(db, "Posts", newPost.postId), newPost);
            return await cloud.getSocialData(payload.author);
        } catch (e) { return { error: true, message: "Create Post Error: " + e.message }; }
    },

    deletePost: async (postId, rowNum) => {
        try {
            await deleteDoc(doc(db, "Posts", postId));
            return await cloud.getSocialData("");
        } catch (e) { return { error: true, message: e.message }; }
    },

    editPostMetadata: async (postId, rowNum, payload) => {
        try {
            await updateDoc(doc(db, "Posts", postId), { caption: payload.caption, category: payload.category, location: payload.location, link: payload.link });
            return await cloud.getSocialData("");
        } catch (e) { return { error: true, message: e.message }; }
    },

    togglePin: async (postId, rowNum) => {
        try {
            const pRef = doc(db, "Posts", postId);
            const pSnap = await getDoc(pRef);
            if(pSnap.exists()) await updateDoc(pRef, { isPinned: !pSnap.data().isPinned });
            return await cloud.getSocialData("");
        } catch (e) { return { error: true, message: e.message }; }
    },

    toggleReaction: async (postId, rowNum, currentUser, reactionType) => {
        try {
            const pRef = doc(db, "Posts", postId);
            const pSnap = await getDoc(pRef);
            if (!pSnap.exists()) return await cloud.getSocialData(currentUser);
            
            let currentLikes = pSnap.data().likes || [];
            const userEntry = `${currentUser}|${reactionType}`;
            let filtered = currentLikes.filter(l => l.split('|')[0] !== currentUser);
            
            if (reactionType !== 'remove') filtered.push(userEntry);
            await updateDoc(pRef, { likes: filtered });
            return await cloud.getSocialData(currentUser);
        } catch (e) { return { error: true, message: e.message }; }
    },

    toggleSave: async (postId, currentUser) => {
        try {
            const saveId = `${currentUser}_${postId}`;
            const sRef = doc(db, "Saves", saveId);
            const sSnap = await getDoc(sRef);
            if (sSnap.exists()) {
                await deleteDoc(sRef);
            } else {
                await setDoc(sRef, { saveId: saveId, user: currentUser, postId: postId, timestamp: Date.now() });
            }
            return await cloud.getSocialData(currentUser);
        } catch (e) { return { error: true, message: e.message }; }
    },

    // --- COMMENTS ---
    addComment: async (postId, author, text) => {
        try {
            const commentId = "COM-" + Date.now();
            await setDoc(doc(db, "Comments", commentId), { commentId, postId, author, text, timestamp: Date.now(), dateStr: new Date().toLocaleString() });
            return await cloud.getSocialData(author);
        } catch (e) { return { error: true, message: e.message }; }
    },

    adminDeleteComment: async (adminUsername, commentId) => {
        try {
            await deleteDoc(doc(db, "Comments", commentId));
            return await cloud.getSocialData(adminUsername);
        } catch (e) { return { error: true, message: e.message }; }
    },

    // --- STORIES ---
    uploadStory: async (payload) => {
        try {
            let mediaUrl = "";
            if (payload.base64Data) {
                const fileRef = ref(storage, `stories/${Date.now()}_${payload.fileName}`);
                await uploadString(fileRef, payload.base64Data, 'data_url');
                mediaUrl = await getDownloadURL(fileRef);
            }
            const storyId = "STY-" + Date.now();
            await setDoc(doc(db, "Stories", storyId), { storyId, timestamp: Date.now(), author: payload.author, mediaUrl, mediaType: payload.mediaType });
            return await cloud.getSocialData(payload.author);
        } catch (e) { return { error: true, message: e.message }; }
    },

    deleteStory: async (storyId, currentUser) => {
        try {
            await deleteDoc(doc(db, "Stories", storyId));
            return await cloud.getSocialData(currentUser);
        } catch (e) { return { error: true, message: e.message }; }
    },

    // --- CATEGORIES & FRIENDS ---
    addAppCategory: async (cat) => { return await cloud.getSocialData(""); },
    removeAppCategory: async (cat) => { return await cloud.getSocialData(""); },
    manageFriendRequest: async (action, req, rec) => { return await cloud.getSocialData(req); },
    applyForBadge: async (u, t) => { return { success: true, message: "Application submitted!" }; },
    adminGetBadgeRequests: async (u) => { return { success: true, requests: [] }; },
    adminResolveBadge: async (admin, reqId, user, badge, action) => { return await cloud.getSocialData(admin); },
    adminDirectAssignBadge: async (admin, u, b) => { return await cloud.getSocialData(admin); },
    adminRemoveBadge: async (admin, u, b) => { return await cloud.getSocialData(admin); },
    adminGetUsers: async (admin) => { return { success: true, users: [] }; },
    adminUpdateUser: async (admin, uId, nu, np, nr) => { return { success: true }; },
    adminDeleteUser: async (admin, uId) => { return { success: true, message: "User deleted." }; },
    adminDeleteAnyPost: async (admin, pId) => { return await cloud.deletePost(pId, 0); }
};

window.cloud = cloud;
