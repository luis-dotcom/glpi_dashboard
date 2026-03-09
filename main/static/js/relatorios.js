document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("relatoriosForm");
    const dataInicio = document.getElementById("data_inicio");
    const dataFim = document.getElementById("data_fim");

    if (form && dataInicio && dataFim) {
        form.addEventListener("submit", function (event) {
            if (dataInicio.value && dataFim.value && dataInicio.value > dataFim.value) {
                event.preventDefault();
                alert("A data inicial não pode ser maior que a data final.");
            }
        });
    }
});