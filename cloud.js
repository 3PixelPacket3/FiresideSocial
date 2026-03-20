// cloud.js - Fireside Backend Interface

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlAO7Ofi0MT8bS2C0him2Rd2edU4BoPMU",
  authDomain: "fireside-social-cd70b.firebaseapp.com",
  projectId: "fireside-social-cd70b",
  storageBucket: "fireside-social-cd70b.firebasestorage.app",
  messagingSenderId: "437430485808",
  appId: "1:437430485808:web:3f40a703426a8537f67ef5",
  measurementId: "G-6EET11P6VT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Helper to convert usernames to Firebase-compatible emails
const formatUsernameAsEmail = (username) => {
    return `${username.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@fireside.local`;
};

export const cloud = {
    // --- AUTHENTICATION & USERS ---
    
    registerUser: async (username, password) => {
        try {
            const cleanUser = String(username).trim();
            const searchUser = cleanUser.toLowerCase();
            const email = formatUsernameAsEmail(cleanUser);

            // 1. Check if username is already taken in Firestore
            const usersRef = collection(db, "Users");
            const q = query(usersRef, where("usernameLower", "==", searchUser));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                return { error: true, message: "Username already taken. Please choose another." };
            }

            // 2. Create the user in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 3. Create their profile document in Firestore (Replacing the Google Sheet row)
            const newProfile = {
                userId: user.uid,
                username: cleanUser,
                usernameLower: searchUser,
                bio: "New to Fireside",
                profilePic: "",
                theme: "dark",
                role: "user",
                notifClearTime: 0,
                location: "",
                website: "",
                pronouns: "",
                badges: [],
                hideFromSearch: false,
                createdAt: new Date().getTime()
            };

            await setDoc(doc(db, "Users", user.uid), newProfile);

            return { success: true, message: "Account created successfully." };

        } catch (error) {
            let errorMsg = error.message;
            if (error.code === 'auth/weak-password') errorMsg = "Password should be at least 6 characters.";
            return { error: true, message: "Registration Error: " + errorMsg };
        }
    },

    authenticateUser: async (username, password) => {
        try {
            const email = formatUsernameAsEmail(username);

            // 1. Log in via Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Fetch their full profile from Firestore
            const userDocRef = doc(db, "Users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                 return { error: true, message: "CRITICAL: Auth succeeded, but profile data is missing." };
            }

            const profileData = userDocSnap.data();

            return { 
                success: true, 
                user: {
                    userId: profileData.userId,
                    username: profileData.username,
                    bio: profileData.bio,
                    profilePic: profileData.profilePic,
                    theme: profileData.theme,
                    role: profileData.role,
                    notifClearTime: profileData.notifClearTime || 0,
                    location: profileData.location || "",
                    website: profileData.website || "",
                    pronouns: profileData.pronouns || ""
                } 
            };

        } catch (error) {
            let errorMsg = "Invalid credentials. Access denied.";
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                errorMsg = "Invalid username or password.";
            }
            return { error: true, message: errorMsg };
        }
    }
};

// Make it globally available for the frontend app.js
window.cloud = cloud;
