document.addEventListener("DOMContentLoaded", function () {
    const passwordInput = document.getElementById("id_password");
    const togglePassword = document.getElementById("togglePassword");

    if (passwordInput && togglePassword) {
        togglePassword.addEventListener("click", function () {
            if (passwordInput.type === "password") {
                passwordInput.type = "text";
                togglePassword.textContent = "Ocultar";
            } else {
                passwordInput.type = "password";
                togglePassword.textContent = "Mostrar";
            }
        });
    }
});