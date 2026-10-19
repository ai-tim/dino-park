// Модуль отслеживания угловых маркеров раскраски и работы с камерой
class DinoMarkerTracker {
    constructor(videoElement, canvasElement) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.isTracking = false;
    }

    async initCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }, // Используем основную камеру телефона
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();
            this.isTracking = true;
            this.startProcessing();
        } catch (error) {
            console.error('Ошибка доступа к камере:', error);
            alert('Не удалось получить доступ к камере. Проверьте разрешения в браузере.');
        }
    }

    startProcessing() {
        const processFrame = () => {
            if (!this.isTracking) return;
            
            // Отрисовка кадра с камеры для анализа угловых маркеров 6x6
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Здесь в будущем будет поиск черных угловых меток перспективы
            // и вычисление координат для привязки 3D-модели динозавра
            
            requestAnimationFrame(processFrame);
        };
        requestAnimationFrame(processFrame);
    }

    stop() {
        this.isTracking = false;
        if (this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
    }
}
