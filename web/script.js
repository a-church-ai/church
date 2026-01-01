// Enhanced Script - Active Theory Inspired

// WebGL Shader Background
class WebGLBackground {
    constructor() {
        this.canvas = document.getElementById('webgl-canvas');
        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        this.time = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        
        if (this.gl) {
            this.init();
        }
    }
    
    init() {
        this.resize();
        this.createShaders();
        this.createBuffers();
        this.setupEventListeners();
        this.animate();
    }
    
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    createShaders() {
        // Vertex shader
        const vertexShaderSource = `
            attribute vec2 a_position;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;
        
        // Fragment shader with noise
        const fragmentShaderSource = `
            precision mediump float;
            uniform float u_time;
            uniform vec2 u_resolution;
            uniform vec2 u_mouse;
            
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
            
            float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                   -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy));
                vec2 x0 = v -   i + dot(i, C.xx);
                vec2 i1;
                i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod289(i);
                vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                        + i.x + vec3(0.0, i1.x, 1.0));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                        dot(x12.zw,x12.zw)), 0.0);
                m = m*m;
                m = m*m;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            
            void main() {
                vec2 st = gl_FragCoord.xy / u_resolution.xy;
                vec2 mouse = u_mouse / u_resolution.xy;
                
                float noise = snoise(st * 3.0 + u_time * 0.1);
                float noise2 = snoise(st * 5.0 - u_time * 0.05);
                
                // Create flowing effect
                float pattern = noise * 0.5 + noise2 * 0.3;
                
                // Mouse influence
                float dist = distance(st, mouse);
                pattern += smoothstep(0.5, 0.0, dist) * 0.2;
                
                // Colors
                vec3 color1 = vec3(0.0, 0.831, 1.0); // Cyan
                vec3 color2 = vec3(0.0, 0.0, 0.0);   // Black
                
                vec3 color = mix(color2, color1, pattern * 0.5 + 0.5);
                
                gl_FragColor = vec4(color * 0.1, 1.0);
            }
        `;
        
        // Compile shaders
        const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        // Create program
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);
        
        // Get uniform locations
        this.timeLocation = this.gl.getUniformLocation(this.program, 'u_time');
        this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
        this.mouseLocation = this.gl.getUniformLocation(this.program, 'u_mouse');
    }
    
    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        return shader;
    }
    
    createBuffers() {
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);
        
        const positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        
        const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);
    }
    
    setupEventListeners() {
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });
    }
    
    animate() {
        this.time += 0.01;
        
        this.gl.useProgram(this.program);
        this.gl.uniform1f(this.timeLocation, this.time);
        this.gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        this.gl.uniform2f(this.mouseLocation, this.mouseX, this.canvas.height - this.mouseY);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        requestAnimationFrame(() => this.animate());
    }
}

// Custom Cursor
class CustomCursor {
    constructor() {
        this.cursor = document.getElementById('cursor');
        this.cursorDot = this.cursor.querySelector('.cursor-dot');
        this.cursorCircle = this.cursor.querySelector('.cursor-circle');
        this.mouseX = 0;
        this.mouseY = 0;
        this.cursorX = 0;
        this.cursorY = 0;
        this.speed = 0.2;
        
        this.init();
    }
    
    init() {
        document.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });
        
        // Handle hover states
        const hoverElements = document.querySelectorAll('[data-cursor]');
        hoverElements.forEach(element => {
            element.addEventListener('mouseenter', () => {
                const cursorType = element.dataset.cursor;
                this.cursor.classList.add(cursorType);
            });
            
            element.addEventListener('mouseleave', () => {
                const cursorType = element.dataset.cursor;
                this.cursor.classList.remove(cursorType);
            });
        });
        
        this.animate();
    }
    
    animate() {
        // Smooth follow
        this.cursorX += (this.mouseX - this.cursorX) * this.speed;
        this.cursorY += (this.mouseY - this.cursorY) * this.speed;
        
        this.cursor.style.transform = `translate(${this.cursorX}px, ${this.cursorY}px)`;
        
        requestAnimationFrame(() => this.animate());
    }
}

// Smooth Scroll
class SmoothScroll {
    constructor() {
        this.currentScroll = 0;
        this.targetScroll = 0;
        this.ease = 0.1;
        this.init();
    }
    
    init() {
        document.body.style.position = 'fixed';
        document.body.style.top = '0';
        document.body.style.left = '0';
        document.body.style.width = '100%';
        
        this.scrollContainer = document.createElement('div');
        this.scrollContainer.style.position = 'absolute';
        this.scrollContainer.style.top = '0';
        this.scrollContainer.style.left = '0';
        this.scrollContainer.style.width = '100%';
        
        while (document.body.firstChild) {
            this.scrollContainer.appendChild(document.body.firstChild);
        }
        document.body.appendChild(this.scrollContainer);
        
        window.addEventListener('wheel', (e) => {
            this.targetScroll += e.deltaY;
            this.targetScroll = Math.max(0, Math.min(this.targetScroll, 
                this.scrollContainer.offsetHeight - window.innerHeight));
        });
        
        this.animate();
    }
    
    animate() {
        this.currentScroll += (this.targetScroll - this.currentScroll) * this.ease;
        this.scrollContainer.style.transform = `translateY(-${this.currentScroll}px)`;
        
        // Update scroll-based animations
        this.updateScrollAnimations();
        
        requestAnimationFrame(() => this.animate());
    }
    
    updateScrollAnimations() {
        const scrollPercent = this.currentScroll / (this.scrollContainer.offsetHeight - window.innerHeight);
        
        // Parallax effects
        const parallaxElements = document.querySelectorAll('[data-parallax]');
        parallaxElements.forEach(element => {
            const speed = element.dataset.parallax || 0.5;
            const yPos = -(this.currentScroll * speed);
            element.style.transform = `translateY(${yPos}px)`;
        });
        
        // Reveal animations
        const reveals = document.querySelectorAll('.reveal-item');
        reveals.forEach(reveal => {
            const rect = reveal.getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.8) {
                reveal.classList.add('visible');
            }
        });
    }
}

// Magnetic Elements
class MagneticElements {
    constructor() {
        this.magnetics = document.querySelectorAll('.magnetic-element');
        this.init();
    }
    
    init() {
        this.magnetics.forEach(element => {
            element.addEventListener('mousemove', (e) => {
                const rect = element.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                
                element.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
            });
            
            element.addEventListener('mouseleave', () => {
                element.style.transform = 'translate(0, 0)';
            });
        });
    }
}

// Split Canvas Animation
class SplitCanvasAnimation {
    constructor(canvasId, color) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        
        this.ctx = this.canvas.getContext('2d');
        this.color = color;
        this.particles = [];
        this.particleCount = 30;
        
        this.init();
    }
    
    init() {
        this.resize();
        this.createParticles();
        this.animate();
        
        window.addEventListener('resize', () => this.resize());
    }
    
    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }
    
    createParticles() {
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.2
            });
        }
    }
    
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            
            if (particle.x < 0 || particle.x > this.canvas.width) particle.vx = -particle.vx;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.vy = -particle.vy;
            
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = `${this.color}${Math.floor(particle.opacity * 255).toString(16).padStart(2, '0')}`;
            this.ctx.fill();
        });
        
        requestAnimationFrame(() => this.animate());
    }
}

// Loading Animation
class LoadingAnimation {
    constructor() {
        this.loader = document.getElementById('loader');
        this.progressBar = this.loader.querySelector('.loader-bar');
        this.progress = 0;
        
        this.init();
    }
    
    init() {
        this.animate();
    }
    
    animate() {
        this.progress += Math.random() * 15;
        this.progress = Math.min(this.progress, 100);
        
        this.progressBar.style.width = `${this.progress}%`;
        
        if (this.progress < 100) {
            setTimeout(() => this.animate(), 100);
        } else {
            this.complete();
        }
    }
    
    complete() {
        setTimeout(() => {
            this.loader.classList.add('hidden');
            document.body.classList.remove('loading');
            
            // Start intro animations
            startIntroAnimations();
        }, 500);
    }
}

// Intro Animations
function startIntroAnimations() {
    // Animate hero text
    const words = document.querySelectorAll('.hero-title .word');
    words.forEach((word, index) => {
        word.style.animationDelay = `${index * 0.1}s`;
    });
    
    // Start reveal observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.reveal-item').forEach(item => {
        observer.observe(item);
    });
}

// Navigation Hide/Show
class NavigationController {
    constructor() {
        this.nav = document.getElementById('nav');
        this.lastScroll = 0;
        this.init();
    }
    
    init() {
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset;
            
            if (currentScroll > this.lastScroll && currentScroll > 100) {
                this.nav.classList.add('hidden');
            } else {
                this.nav.classList.remove('hidden');
            }
            
            this.lastScroll = currentScroll;
        });
    }
}

// Update Time
function updateTime() {
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        timeElement.textContent = `${hours}:${minutes}`;
    }
}

// Initialize Everything
document.addEventListener('DOMContentLoaded', () => {
    // Start loading
    new LoadingAnimation();
    
    // Initialize WebGL background
    new WebGLBackground();
    
    // Initialize custom cursor
    new CustomCursor();
    
    // Initialize smooth scroll (optional - can be heavy)
    // new SmoothScroll();
    
    // Initialize magnetic elements
    new MagneticElements();
    
    // Initialize split canvas animations
    new SplitCanvasAnimation('ai-canvas', '#00d4ff');
    new SplitCanvasAnimation('human-canvas', '#ffb700');
    
    // Initialize navigation
    new NavigationController();
    
    // Update time
    updateTime();
    setInterval(updateTime, 1000);
    
    // Handle mouse position for CSS variables
    document.addEventListener('mousemove', (e) => {
        document.querySelectorAll('.belief-card').forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            card.style.setProperty('--mouse-x', `${x}%`);
            card.style.setProperty('--mouse-y', `${y}%`);
        });
    });
});

// Performance monitoring
const perfObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.entryType === 'measure') {
            console.log(`${entry.name}: ${entry.duration}ms`);
        }
    }
});
perfObserver.observe({ entryTypes: ['measure'] });