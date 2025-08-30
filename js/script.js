// Espera o DOM carregar pra rodar o script
document.addEventListener('DOMContentLoaded', () => {

    // --- Seleciona todos os elementos de uma vez ---
    const ui = {
        container: document.querySelector('.container'),
        qrInput: document.getElementById('qr-input'),
        generateBtn: document.querySelector('.generate-btn'),
        qrCanvas: document.getElementById('qrcode-canvas'),
        qrDataText: document.querySelector('.qr-data-text'),
        downloadBtn: document.querySelector('.download-btn'),
        backBtn: document.querySelector('.back-btn'),
        errorMessage: document.querySelector('.error-message')
    };

    let qrcodeInstance = null;

    // --- Funções principais ---
    const generateQRCode = () => {
        const qrValue = ui.qrInput.value.trim();
        ui.errorMessage.textContent = '';

        if (!qrValue) {
            ui.errorMessage.textContent = 'Por favor, insira um texto ou URL.';
            ui.qrInput.classList.add('error');
            setTimeout(() => ui.qrInput.classList.remove('error'), 500);
            return;
        }

        ui.qrCanvas.innerHTML = '';
        qrcodeInstance = new QRCode(ui.qrCanvas, {
            text: qrValue,
            width: 200, height: 200,
            colorDark: "#000000", colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        const displayText = qrValue.length > 40 ? `${qrValue.substring(0, 38)}...` : qrValue;
        ui.qrDataText.textContent = `Dados: ${displayText}`;
        ui.container.classList.add('show-result');
    };

    const downloadQRCode = () => {
        const canvas = ui.qrCanvas.querySelector('canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = 'qrcode.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
    };

    const returnToForm = () => {
        ui.container.classList.remove('show-result');
        ui.qrInput.value = '';
        setTimeout(() => {
            ui.qrCanvas.innerHTML = '';
            ui.qrDataText.textContent = '';
        }, 500);
    };

    // --- Liga os eventos aos elementos ---
    ui.generateBtn.addEventListener('click', generateQRCode);
    ui.downloadBtn.addEventListener('click', downloadQRCode);
    ui.backBtn.addEventListener('click', returnToForm);
    
    ui.qrInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            generateQRCode();
        }
    });
    
    ui.qrInput.addEventListener('input', () => {
        ui.errorMessage.textContent = '';
    });
});

// --- Animação de entrada ---
// Espera a página inteira carregar
window.addEventListener('load', () => {
    document.body.classList.remove('loading');
});