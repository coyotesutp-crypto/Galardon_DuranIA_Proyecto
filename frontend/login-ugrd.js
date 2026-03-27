//Ya terminé la alidación de credenciales --- Oscar 
<script src="login-ugrd.js" defer></script>
document.getElementById('login-admin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('admin-user').value;
    const pass = document.getElementById('admin-pass').value;

    if (user === 'adminugrd' && pass === 'admin123') {
        sessionStorage.setItem('adminActive', JSON.stringify({ user: 'admin_ugrd' }));
        window.location.href = 'ugrd.html';
    } else {
        alert('Credenciales incorrectas');
    }
});