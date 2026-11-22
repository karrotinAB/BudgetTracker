// 저장소: Firebase(로그인 + 클라우드 동기화) 또는 로컬(체험 모드)
import { firebaseConfig } from './firebase-config.js?v=5';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const emptyData = () => ({ settings: { salary: 0, fixed: [] }, snapshots: [], days: {} });

// ---------- 로컬 저장소 ----------
const LOCAL_KEY = 'gagyebu:v1';
const LOCAL_SESSION = 'gagyebu:local-session';

function readLocal() {
  try { return { ...emptyData(), ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }; }
  catch { return emptyData(); }
}
function writeLocal(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch { /* 저장 불가 환경 */ }
}

class LocalStore {
  async load() { this.data = readLocal(); return structuredClone(this.data); }
  async saveSettings(settings, snapshots) {
    this.data.settings = settings; this.data.snapshots = snapshots; writeLocal(this.data);
  }
  async saveDay(date, items) {
    if (items.length) this.data.days[date] = items; else delete this.data.days[date];
    writeLocal(this.data);
  }
}

// ---------- Firebase ----------
let fb = null;
async function loadFirebase() {
  if (fb) return fb;
  const [appM, authM, fsM] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  await authM.setPersistence(auth, authM.browserLocalPersistence); // 자동 로그인 유지
  let db;
  try {
    db = fsM.initializeFirestore(app, {
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
  } catch { db = fsM.getFirestore(app); }
  fb = { authM, fsM, auth, db };
  return fb;
}

class FirebaseStore {
  constructor(uid) { this.uid = uid; }
  async load() {
    const { fsM, db } = fb;
    const userRef = fsM.doc(db, 'users', this.uid);
    const [userSnap, daySnaps] = await Promise.all([
      fsM.getDoc(userRef),
      fsM.getDocs(fsM.collection(db, 'users', this.uid, 'days')),
    ]);
    const data = emptyData();
    if (userSnap.exists()) {
      const u = userSnap.data();
      data.settings = u.settings || data.settings;
      data.snapshots = u.snapshots || [];
    }
    daySnaps.forEach((d) => { data.days[d.id] = d.data().items || []; });
    return data;
  }
  async saveSettings(settings, snapshots) {
    const { fsM, db } = fb;
    await fsM.setDoc(fsM.doc(db, 'users', this.uid), { settings, snapshots }, { merge: true });
  }
  async saveDay(date, items) {
    const { fsM, db } = fb;
    const ref = fsM.doc(db, 'users', this.uid, 'days', date);
    if (items.length) await fsM.setDoc(ref, { items }); else await fsM.deleteDoc(ref);
  }
}

// ---------- 인증 ----------
/** 로그인 상태 감시. cb(user|null). user = { uid, email, name, local } */
export async function watchAuth(cb) {
  if (!firebaseEnabled) {
    const s = localStorage.getItem(LOCAL_SESSION);
    cb(s ? { uid: 'local', email: null, name: '체험 모드', local: true } : null);
    return;
  }
  const { authM, auth } = await loadFirebase();
  authM.onAuthStateChanged(auth, (u) =>
    cb(u ? { uid: u.uid, email: u.email, name: u.displayName || u.email, local: false } : null));
}

export async function startLocal() { localStorage.setItem(LOCAL_SESSION, '1'); }

export async function signInEmail(email, pw) {
  const { authM, auth } = await loadFirebase();
  return authM.signInWithEmailAndPassword(auth, email, pw);
}
export async function signUpEmail(email, pw) {
  const { authM, auth } = await loadFirebase();
  return authM.createUserWithEmailAndPassword(auth, email, pw);
}
export async function signInGoogle() {
  const { authM, auth } = await loadFirebase();
  const provider = new authM.GoogleAuthProvider();
  try { return await authM.signInWithPopup(auth, provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      return authM.signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
export async function signOut(user) {
  if (user?.local) { localStorage.removeItem(LOCAL_SESSION); location.reload(); return; }
  const { authM, auth } = await loadFirebase();
  await authM.signOut(auth);
}

export const storeFor = (user) => (user.local ? new LocalStore() : new FirebaseStore(user.uid));

export function authErrorMessage(e) {
  const map = {
    'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/user-not-found': '가입되지 않은 이메일이에요.',
    'auth/email-already-in-use': '이미 가입된 이메일이에요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
    'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해주세요.',
    'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔어요.',
  };
  return map[e?.code] || '로그인 중 문제가 생겼어요. 다시 시도해주세요.';
}
