const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ⚠️ 因為你 HTML 用 onclick，需要掛到 window

window.handleLogin = async function() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('errorMsg');
    const btn = document.getElementById('loginBtn');
 
    errorMsg.textContent = '';
 
    if (!username || !password) {
        errorMsg.textContent = 'Please fill in all fields.';
        return;
    }
 
    const email = `${username}@mindmap.com`;
    btn.classList.add('loading');
 
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
 
    btn.classList.remove('loading');
 
    if (error) {
        errorMsg.textContent = 'Incorrect username or password.';
        return;
    }
 
    window.location.href = 'index.html';
}