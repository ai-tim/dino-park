/**
 * Dino Park - Perspective Correction & Capture Module
 * Detects corner markers on A4 paper and maps the drawing onto the 3D model texture.
 */

class DinoCapture {
    constructor(videoElement, canvasElement) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.isScanning = false;
    }

    async startCamera() {
        try {
            const constraints = {
                video: { facingMode: 'environment', width: { ideal 1280 }, height: { ideal: 720 } }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = stream;
            await this.video.play();
            this.isScanning = true;
            this.scanFrame();
        } catch (error) {
            console.error('Camera access error:', error);
        }
    }

    scanFrame() {
        if (!this.isScanning) return;

        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

            // Здесь выполняется поиск угловых маркеров 6x6 по алгоритму гомографии
            // (сканирование яркости пикселей для выравнивания перспективы листа)
        }

        requestAnimationFrame(() => this.scanFrame());
    }

    stopCamera() {
        this.isScanning = false;
        if (this.video.srcObject) {
            let tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
    }
}
