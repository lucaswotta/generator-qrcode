(() => {
    'use strict';

    // --- 1. Configurações e Constantes ---
    const CONFIG = {
        QR_CODE: {
            WIDTH: 500,
            HEIGHT: 500,
            CORRECT_LEVEL: typeof QRCode !== 'undefined' ? QRCode.CorrectLevel.H : 1
        },
        CANVAS: {
            PREVIEW_SIZE: 600,
            PADDING: 40,
            QR_WRAPPER_PADDING: 15,
            LOGO_BACKGROUND_PADDING: 5,
            TEXT_ZONE_HEIGHT: 100,
            BORDER_RADIUS: {
                WRAPPER: 12,
                LOGO: 8
            }
        },
        LOGO: {
            MAX_SIZE_MB: 2,
            SIZE_RATIO: 0.25,
            MIN_ASPECT_RATIO: 0.5,
            MAX_ASPECT_RATIO: 2
        },
        IMAGE_COMPRESSION: {
            MAX_WIDTH: 512,
            MAX_HEIGHT: 512,
            QUALITY: 0.8,
            TYPE: 'image/jpeg'
        },
        TIMING: {
            DEBOUNCE_DELAY: 400,
            ERROR_DISPLAY_DURATION: 4000,
            SUCCESS_DISPLAY_DURATION: 2000,
            RENDER_DELAY: 400
        },
        VALIDATION: {
            MAX_TEXT_LENGTH: 2000,
            SUPPORTED_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/svg+xml']
        }
    };

    // --- 2. Sistema de Logging Estruturado ---
    const Logger = {
        levels: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
        currentLevel: 2, // Nível padrão: INFO

        _log(level, message, data = null) {
            if (level > this.currentLevel) return;

            const timestamp = new Date().toISOString();
            const levelName = Object.keys(this.levels)[level];

            const logEntry = {
                timestamp,
                level: levelName,
                message,
                data,
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            console[level === 0 ? 'error' : level === 1 ? 'warn' : 'log'](
                `[${timestamp}] ${levelName}: ${message}`,
                data ? data : ''
            );

            // Em um ambiente de produção, estes logs poderiam ser enviados para um serviço externo
            if (level === 0) { // ERROR
                this._reportError(logEntry);
            }
        },

        error(message, data) { this._log(0, message, data); },
        warn(message, data) { this._log(1, message, data); },
        info(message, data) { this._log(2, message, data); },
        debug(message, data) { this._log(3, message, data); },

        _reportError(logEntry) {
            // Espaço reservado para um sistema de relatórios de erro
            // Ex: Sentry, LogRocket, etc.
            try {
                localStorage.setItem('qr_last_error', JSON.stringify(logEntry));
            } catch (e) {
                // Fallback silencioso caso o localStorage não esteja disponível
            }
        }
    };

    // --- 3. Seleção de Elementos e Estado ---
    const ui = {
        container: document.querySelector('.container'),
        form: document.getElementById('qr-form'),
        qrInput: document.getElementById('qr-input'),
        errorMessage: document.getElementById('error-message'),
        templateTextInput: document.getElementById('template-text-input'),
        qrCanvas: document.getElementById('qr-canvas'),
        downloadBtn: document.querySelector('.download-btn'),
        backBtn: document.querySelector('.back-btn'),
        logoUpload: document.getElementById('logo-upload'),
        logoUploadLabel: document.querySelector('.custom-file-upload'),
        logoFileName: document.getElementById('logo-file-name'),
        colorPalette: document.getElementById('color-palette'),
        customColorPicker: document.getElementById('custom-color-picker'),
        customColorLabel: document.querySelector('.custom-color-label'),
        customColorSwatch: document.querySelector('.custom-color-swatch'),
        resolutionOptions: document.querySelector('.resolution-options')
    };

    const state = {
        qrText: '',
        templateText: '',
        templateColor: '#0f172a',
        logoImage: null,
        compressedLogoImage: null,
        errorTimer: null,
        isDownloading: false,
        isGenerating: false,
        tempCanvasElements: new Set() // Para limpeza e prevenção de vazamentos de memória
    };

    // --- 4. Funções Utilitárias ---
    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const loadImage = (src) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeoutId = setTimeout(() => {
                img.onload = img.onerror = null;
                reject(new Error('Timeout ao carregar imagem'));
            }, 10000);

            img.onload = () => {
                clearTimeout(timeoutId);
                resolve(img);
            };

            img.onerror = () => {
                clearTimeout(timeoutId);
                reject(new Error('Falha ao carregar a imagem'));
            };

            img.src = src;
        });
    };

    const getLuminance = (hex) => {
        try {
            const rgb = parseInt(hex.slice(1), 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = (rgb >> 0) & 0xff;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        } catch (error) {
            Logger.error('Erro ao calcular luminância', { hex, error: error.message });
            return 128; // valor padrão
        }
    };

    // --- 5. Sistema de Compressão de Imagens ---
    const ImageCompressor = {
        compress(file, options = {}) {
            return new Promise((resolve, reject) => {
                const {
                    maxWidth = CONFIG.IMAGE_COMPRESSION.MAX_WIDTH,
                    maxHeight = CONFIG.IMAGE_COMPRESSION.MAX_HEIGHT,
                    quality = CONFIG.IMAGE_COMPRESSION.QUALITY,
                    type = CONFIG.IMAGE_COMPRESSION.TYPE
                } = options;

                if (file.type === 'image/svg+xml') {
                    // SVG não precisa de compressão
                    resolve(file);
                    return;
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();

                img.onload = () => {
                    try {
                        // Calcula as novas dimensões mantendo a proporção
                        let { width, height } = img;

                        if (width > height) {
                            if (width > maxWidth) {
                                height = (height * maxWidth) / width;
                                width = maxWidth;
                            }
                        } else {
                            if (height > maxHeight) {
                                width = (width * maxHeight) / height;
                                height = maxHeight;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;

                        // Desenha a imagem redimensionada no canvas
                        ctx.drawImage(img, 0, 0, width, height);

                        // Converte o conteúdo do canvas para um Blob
                        canvas.toBlob((blob) => {
                            if (blob) {
                                Logger.info('Imagem comprimida', {
                                    originalSize: file.size,
                                    compressedSize: blob.size,
                                    compressionRatio: ((1 - blob.size / file.size) * 100).toFixed(1) + '%'
                                });
                                resolve(blob);
                            } else {
                                reject(new Error('Falha na compressão da imagem'));
                            }
                        }, type, quality);

                    } catch (error) {
                        Logger.error('Erro durante compressão', error);
                        reject(error);
                    }
                };

                img.onerror = () => reject(new Error('Falha ao carregar imagem para compressão'));
                img.src = URL.createObjectURL(file);
            });
        }
    };

    // --- 6. Sistema de Validação ---
    const Validator = {
        validateText(text) {
            if (!text || typeof text !== 'string') {
                return { valid: false, error: 'Texto inválido' };
            }

            const trimmed = text.trim();
            if (trimmed.length === 0) {
                return { valid: false, error: 'Por favor, insira um texto ou URL.' };
            }

            if (trimmed.length > CONFIG.VALIDATION.MAX_TEXT_LENGTH) {
                return { valid: false, error: `Texto muito longo. Máximo: ${CONFIG.VALIDATION.MAX_TEXT_LENGTH} caracteres.` };
            }

            return { valid: true };
        },

        validateImageFile(file) {
            if (!file) {
                return { valid: false, error: 'Nenhum arquivo selecionado' };
            }

            if (!CONFIG.VALIDATION.SUPPORTED_IMAGE_TYPES.includes(file.type)) {
                return { valid: false, error: 'Formato inválido. Use PNG, JPG ou SVG.' };
            }

            if (file.size / 1024 / 1024 > CONFIG.LOGO.MAX_SIZE_MB) {
                return { valid: false, error: `Arquivo muito grande. Máximo: ${CONFIG.LOGO.MAX_SIZE_MB}MB.` };
            }

            return { valid: true };
        },

        validateImageDimensions(img) {
            const aspectRatio = img.naturalWidth / img.naturalHeight;

            if (aspectRatio < CONFIG.LOGO.MIN_ASPECT_RATIO || aspectRatio > CONFIG.LOGO.MAX_ASPECT_RATIO) {
                return { valid: false, error: 'A imagem deve ser aproximadamente quadrada.' };
            }

            return { valid: true };
        }
    };

    // --- 7. Limpeza de Vazamentos de Memória ---
    const MemoryManager = {
        cleanup() {
            // Limpa os elementos canvas temporários
            state.tempCanvasElements.forEach(element => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            });
            state.tempCanvasElements.clear();

            // Limpa as Object URLs para liberar memória
            if (state.compressedLogoImage && state.compressedLogoImage.src?.startsWith('blob:')) {
                URL.revokeObjectURL(state.compressedLogoImage.src);
            }
        },

        addTempCanvas(canvas) {
            state.tempCanvasElements.add(canvas);
        }
    };

    // --- 8. Renderização de QR Code ---
    const QRRenderer = {
        async createQRCanvas(text, size = CONFIG.QR_CODE.WIDTH) {
            return new Promise((resolve, reject) => {
                try {
                    const tempDiv = document.createElement('div');
                    tempDiv.style.position = 'absolute';
                    tempDiv.style.left = '-9999px';
                    document.body.appendChild(tempDiv);

                    // Registra o elemento temporário para limpeza posterior
                    MemoryManager.addTempCanvas(tempDiv);

                    const qr = new QRCode(tempDiv, {
                        text,
                        width: size,
                        height: size,
                        correctLevel: CONFIG.QR_CODE.CORRECT_LEVEL
                    });

                    // Aguarda a biblioteca gerar o canvas do QR Code
                    setTimeout(() => {
                        const qrCanvas = tempDiv.querySelector('canvas');
                        if (qrCanvas) {
                            resolve(qrCanvas);
                        } else {
                            reject(new Error('Falha ao gerar QR Code canvas'));
                        }
                    }, 100);

                } catch (error) {
                    Logger.error('Erro ao criar QR canvas', error);
                    reject(error);
                }
            });
        },

        drawDynamicText(ctx, text, x, y, maxWidth, initialFontSize) {
            let fontSize = initialFontSize;
            ctx.font = `bold ${fontSize}px Outfit, sans-serif`;

            while (ctx.measureText(text).width > maxWidth && fontSize > 12) {
                fontSize--;
                ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
            }

            const words = text.split(' ');
            let line = '';
            const lines = [];

            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                if (ctx.measureText(testLine).width > maxWidth && n > 0) {
                    lines.push(line);
                    line = words[n] + ' ';
                } else {
                    line = testLine;
                }
            }
            lines.push(line);

            const lineHeight = fontSize * 1.2;
            const totalTextHeight = lines.length * lineHeight;
            let startY = y - (totalTextHeight / 2) + (lineHeight / 2) - (lineHeight * 0.1);

            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i].trim(), x, startY + (i * lineHeight));
            }
        },

        async renderQrCode(canvas, size) {
            const text = state.qrText.trim();
            if (!text) {
                Logger.warn('Tentativa de renderizar QR sem texto');
                return;
            }

            try {
                Logger.debug('Iniciando renderização QR', { text: text.substring(0, 50) + '...', size });

                const ctx = canvas.getContext('2d');
                canvas.width = size;
                canvas.height = size;

                // Fundo do template
                ctx.fillStyle = state.templateColor;
                ctx.fillRect(0, 0, size, size);

                // Gerar QR Code
                const qrCanvas = await this.createQRCanvas(text, CONFIG.QR_CODE.WIDTH);

                const hasTemplateText = state.templateText.trim() !== '';
                const scale = size / CONFIG.CANVAS.PREVIEW_SIZE;
                const textZoneHeight = hasTemplateText ? CONFIG.CANVAS.TEXT_ZONE_HEIGHT * scale : 0;
                const qrPadding = CONFIG.CANVAS.PADDING * scale;

                const qrWrapperSize = size - (qrPadding * 2) - textZoneHeight;
                const qrWrapperY = qrPadding;
                const qrWrapperX = (size - qrWrapperSize) / 2;

                // Fundo do QR Code (wrapper branco)
                const qrBgColor = getLuminance(state.templateColor) > 200 ? '#eeeeee' : '#f8fafc';
                ctx.fillStyle = qrBgColor;
                ctx.beginPath();
                ctx.roundRect(qrWrapperX, qrWrapperY, qrWrapperSize, qrWrapperSize, [CONFIG.CANVAS.BORDER_RADIUS.WRAPPER * scale]);
                ctx.fill();

                // QR Code
                const qrCodePaddingInWrapper = CONFIG.CANVAS.QR_WRAPPER_PADDING * scale;
                ctx.drawImage(
                    qrCanvas,
                    qrWrapperX + qrCodePaddingInWrapper,
                    qrWrapperY + qrCodePaddingInWrapper,
                    qrWrapperSize - (qrCodePaddingInWrapper * 2),
                    qrWrapperSize - (qrCodePaddingInWrapper * 2)
                );

                // Logo
                if (state.compressedLogoImage) {
                    const logoSize = qrWrapperSize * CONFIG.LOGO.SIZE_RATIO;
                    const logoX = (size - logoSize) / 2;
                    const logoY = qrWrapperY + (qrWrapperSize - logoSize) / 2;

                    // Fundo branco para o logo, para garantir visibilidade
                    ctx.fillStyle = '#FFF';
                    ctx.beginPath();
                    const logoBgPadding = CONFIG.CANVAS.LOGO_BACKGROUND_PADDING * scale;
                    ctx.roundRect(logoX - logoBgPadding, logoY - logoBgPadding, logoSize + (logoBgPadding * 2), logoSize + (logoBgPadding * 2), [CONFIG.CANVAS.BORDER_RADIUS.LOGO * scale]);
                    ctx.fill();

                    ctx.drawImage(state.compressedLogoImage, logoX, logoY, logoSize, logoSize);
                }

                // Texto do template (abaixo do QR Code)
                if (hasTemplateText) {
                    const textColor = getLuminance(state.templateColor) > 160 ? '#0f172a' : '#f8fafc';
                    ctx.fillStyle = textColor;
                    ctx.textAlign = 'center';
                    ctx.textTransform = 'uppercase';
                    const textY = size - (textZoneHeight / 2);
                    this.drawDynamicText(ctx, state.templateText.trim(), size / 2, textY, size - (50 * scale), 38 * scale);
                }

                Logger.info('QR Code renderizado com sucesso');

            } catch (error) {
                Logger.error('Erro na renderização do QR Code', error);
                throw error;
            }
        }
    };

    // --- 9. Gerenciamento de Preview ---
    const PreviewManager = {
        async renderPreview() {
            if (!state.qrText.trim()) {
                ui.qrCanvas.style.display = 'none';
                return;
            }

            try {
                ui.qrCanvas.style.display = 'block';
                await QRRenderer.renderQrCode(ui.qrCanvas, CONFIG.CANVAS.PREVIEW_SIZE);
            } catch (error) {
                Logger.error('Erro no preview', error);
                displayError('Erro ao gerar preview do QR Code');
            }
        }
    };

    const debouncedRender = debounce(() => PreviewManager.renderPreview(), CONFIG.TIMING.DEBOUNCE_DELAY);

    // --- 10. Gerenciamento de UI ---
    const showView = (viewName) => {
        ui.container.classList.toggle('show-result', viewName === 'result');
        Logger.debug('Mudança de view', { viewName });
    };

    const displayError = (message) => {
        Logger.warn('Erro exibido ao usuário', { message });

        clearTimeout(state.errorTimer);
        ui.errorMessage.textContent = message;
        ui.errorMessage.classList.add('active');
        ui.qrInput.classList.add('error');

        state.errorTimer = setTimeout(() => {
            clearError();
        }, CONFIG.TIMING.ERROR_DISPLAY_DURATION);
    };

    const clearError = () => {
        ui.errorMessage.classList.remove('active');
        ui.qrInput.classList.remove('error');
    };

    const resetApp = () => {
        Logger.info('Reset da aplicação');

        // Limpeza de memória
        MemoryManager.cleanup();

        ui.form.reset();
        Object.assign(state, {
            qrText: '',
            templateText: '',
            templateColor: '#0f172a',
            logoImage: null,
            compressedLogoImage: null
        });

        ui.logoFileName.textContent = "Adicionar imagem";
        ui.logoUploadLabel.dataset.state = 'placeholder';
        clearError();

        ui.customColorPicker.value = state.templateColor;
        if (ui.customColorSwatch) ui.customColorSwatch.style.backgroundColor = 'transparent';

        const activeSwatch = ui.colorPalette.querySelector('.active');
        if (activeSwatch) activeSwatch.classList.remove('active');

        const defaultSwatch = ui.colorPalette.querySelector('[data-color="#0f172a" i]');
        if (defaultSwatch) defaultSwatch.classList.add('active');

        showView('form');
    };

    // --- 11. Manipuladores de Eventos ---
    const handleFormSubmit = async (event) => {
        event.preventDefault();

        if (state.isGenerating) return;

        const generateBtn = ui.form.querySelector('.generate-btn');
        const validation = Validator.validateText(state.qrText);

        if (!validation.valid) {
            displayError(validation.error);
            return;
        }

        state.isGenerating = true;
        generateBtn.disabled = true;
        generateBtn.querySelector('span').textContent = 'Gerando...';

        try {
            await new Promise(resolve => setTimeout(resolve, CONFIG.TIMING.RENDER_DELAY));
            await PreviewManager.renderPreview();
            showView('result');
            Logger.info('QR Code gerado com sucesso');
        } catch (error) {
            Logger.error('Erro ao gerar QR Code', error);
            displayError('Falha ao gerar o QR Code.');
        } finally {
            state.isGenerating = false;
            generateBtn.disabled = false;
            generateBtn.querySelector('span').textContent = 'Gerar QR Code';
        }
    };

    const handleDownloadClick = async () => {
        if (state.isDownloading) return;

        state.isDownloading = true;

        const selectedResolution = ui.resolutionOptions.querySelector('input:checked').value;
        const downloadCanvas = document.createElement('canvas');

        const originalBtnText = ui.downloadBtn.querySelector('span').textContent;
        const originalBtnIcon = ui.downloadBtn.querySelector('svg').outerHTML;

        ui.downloadBtn.querySelector('span').textContent = 'Preparando...';

        try {
            Logger.info('Iniciando download', { resolution: selectedResolution });

            await QRRenderer.renderQrCode(downloadCanvas, parseInt(selectedResolution, 10));

            const link = document.createElement('a');
            link.download = `qrcode-${Date.now()}.png`;
            link.href = downloadCanvas.toDataURL('image/png');

            // Dispara o download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Feedback visual de sucesso
            ui.downloadBtn.classList.add('btn--success');
            ui.downloadBtn.querySelector('span').textContent = 'Baixado!';
            ui.downloadBtn.querySelector('svg').innerHTML = '<path d="M20 6 9 17l-5-5"/>';

            Logger.info('Download realizado com sucesso');

            setTimeout(() => {
                ui.downloadBtn.classList.remove('btn--success');
                ui.downloadBtn.querySelector('span').textContent = originalBtnText;
                ui.downloadBtn.querySelector('svg').outerHTML = originalBtnIcon;
            }, CONFIG.TIMING.SUCCESS_DISPLAY_DURATION);

        } catch (error) {
            Logger.error('Erro no download', error);
            displayError('Não foi possível preparar o download.');
            ui.downloadBtn.querySelector('span').textContent = originalBtnText;
        } finally {
            state.isDownloading = false;
        }
    };

    const handleLogoUpload = async (event) => {
        const file = event.target.files[0];

        const resetUpload = () => {
            state.logoImage = null;
            state.compressedLogoImage = null;
            ui.logoUpload.value = '';
            ui.logoFileName.textContent = "Adicionar imagem";
            ui.logoUploadLabel.dataset.state = 'placeholder';
            debouncedRender();
        };

        if (!file) {
            resetUpload();
            return;
        }

        // Validar arquivo
        const fileValidation = Validator.validateImageFile(file);
        if (!fileValidation.valid) {
            displayError(fileValidation.error);
            resetUpload();
            return;
        }

        try {
            Logger.info('Processando upload de logo', { fileName: file.name, size: file.size });

            // Comprimir imagem
            const compressedFile = await ImageCompressor.compress(file);

            // Cria uma URL local para a imagem comprimida
            const imageUrl = URL.createObjectURL(compressedFile);

            // Carrega a imagem para validação de dimensões
            const img = await loadImage(imageUrl);

            // Validar dimensões
            const dimensionValidation = Validator.validateImageDimensions(img);
            if (!dimensionValidation.valid) {
                URL.revokeObjectURL(imageUrl);
                displayError(dimensionValidation.error);
                resetUpload();
                return;
            }

            // Armazena a imagem comprimida no estado da aplicação
            state.logoImage = img;
            state.compressedLogoImage = img;
            ui.logoFileName.textContent = file.name;
            ui.logoUploadLabel.dataset.state = 'selected';

            Logger.info('Logo processado com sucesso');
            debouncedRender();

        } catch (error) {
            Logger.error('Erro no processamento do logo', error);
            displayError('Não foi possível processar a imagem.');
            resetUpload();
        }
    };

    const handleStateUpdate = (key, value) => {
        const oldValue = state[key];
        state[key] = value;

        Logger.debug('Estado atualizado', { key, oldValue, newValue: value });

        if (key === 'qrText' && value.trim()) {
            clearError();
        }

        debouncedRender();
    };

    const handleColorSelection = (event) => {
        const target = event.target.closest('.color-swatch');
        if (!target) return;

        ui.colorPalette.querySelector('.active')?.classList.remove('active');
        target.classList.add('active');

        if (target.dataset.color) {
            state.templateColor = target.dataset.color;
            ui.customColorPicker.value = state.templateColor;
            if (ui.customColorSwatch) ui.customColorSwatch.style.backgroundColor = 'transparent';

            Logger.debug('Cor selecionada', { color: state.templateColor });
        }

        debouncedRender();
    };

    const handleCustomColorInput = (event) => {
        state.templateColor = event.target.value;
        if (ui.customColorSwatch) ui.customColorSwatch.style.backgroundColor = state.templateColor;

        ui.colorPalette.querySelector('.active')?.classList.remove('active');
        if (ui.customColorLabel) ui.customColorLabel.classList.add('active');

        Logger.debug('Cor personalizada selecionada', { color: state.templateColor });
        debouncedRender();
    };

    // --- 12. Tratamento Global de Erros ---
    const setupErrorHandling = () => {
        window.addEventListener('error', (event) => {
            Logger.error('Erro JavaScript global', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error?.stack
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.error('Promise rejeitada não tratada', {
                reason: event.reason,
                stack: event.reason?.stack
            });
            event.preventDefault(); // Previne o log padrão do navegador no console
        });

        // Detecta recursos essenciais não suportados pelo navegador
        if (!window.QRCode) {
            Logger.error('Biblioteca QRCode não carregada');
            displayError('Erro ao carregar recursos necessários. Recarregue a página.');
        }

        if (!HTMLCanvasElement.prototype.toBlob) {
            Logger.error('toBlob não suportado');
            displayError('Navegador não suportado para download de imagens.');
        }
    };

    // --- 13. Inicialização ---
    const init = () => {
        try {
            Logger.info('Inicializando aplicação QR Code Generator');

            // Configura o tratamento de erros
            setupErrorHandling();

            // Verifica se os elementos essenciais da UI existem
            const requiredElements = ['form', 'qrInput', 'downloadBtn', 'backBtn', 'qrCanvas'];
            for (const elementKey of requiredElements) {
                if (!ui[elementKey]) {
                    throw new Error(`Elemento obrigatório não encontrado: ${elementKey}`);
                }
            }

            // Adiciona os ouvintes de evento
            ui.form.addEventListener('submit', handleFormSubmit);
            ui.downloadBtn.addEventListener('click', handleDownloadClick);
            ui.backBtn.addEventListener('click', resetApp);
            ui.qrInput.addEventListener('input', e => handleStateUpdate('qrText', e.target.value));
            ui.templateTextInput.addEventListener('input', e => handleStateUpdate('templateText', e.target.value));
            ui.logoUpload.addEventListener('change', handleLogoUpload);
            ui.colorPalette.addEventListener('click', handleColorSelection);
            ui.customColorPicker.addEventListener('input', handleCustomColorInput);

            // Renderiza o QR Code caso o campo de texto já tenha um valor
            if (ui.qrInput.value) {
                state.qrText = ui.qrInput.value;
                debouncedRender();
            }

            // Remove a classe de 'loading' do body quando a página carregar
            window.addEventListener('load', () => {
                document.body.classList.remove('loading');
                Logger.info('Aplicação carregada completamente');
            });

            // Garante a limpeza de memória ao fechar a página
            window.addEventListener('beforeunload', () => {
                MemoryManager.cleanup();
                Logger.info('Cleanup realizado antes de sair');
            });

            Logger.info('Inicialização concluída com sucesso');

        } catch (error) {
            Logger.error('Erro crítico na inicialização', error);

            // Interface de fallback em caso de erro crítico
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#ef4444;color:white;padding:1rem;border-radius:8px;z-index:9999';
            errorDiv.textContent = 'Erro ao inicializar a aplicação. Recarregue a página.';
            document.body.appendChild(errorDiv);
        }
    };

    // Inicializa a aplicação quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();