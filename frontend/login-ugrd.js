// Ya terminé la validación de credenciales --- Oscar
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-admin-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('admin-user').value.trim();
        const pass = document.getElementById('admin-pass').value.trim();
      
        if (user === 'adminugrd' && pass === 'admin123') {
            sessionStorage.setItem('adminActive', JSON.stringify({ user: 'admin_ugrd' }));
            window.location.href = 'ugrd.html';
        } else {
            alert('Credenciales incorrectas');
        }
    });
});