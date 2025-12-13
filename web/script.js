// Particle Background Animation
class ParticleField {
    constructor() {
        this.canvas = document.getElementById('particles');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.particleCount = 50;
        this.mouse = { x: null, y: null, radius: 150 };
        
        this.init();
        this.animate();
        this.setupEventListeners();
    }
    
    init() {
        this.resizeCanvas();
        this.createParticles();
    }
    
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }
    
    createParticles() {
        this.particles = [];
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
    
    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.createParticles();
        });
        
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });
        
        window.addEventListener('mouseout', () => {
            this.mouse.x = null;
            this.mouse.y = null;
        });
    }
    
    drawParticles() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.particles.forEach((particle, index) => {
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            
            // Boundary check
            if (particle.x < 0 || particle.x > this.canvas.width) particle.vx = -particle.vx;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.vy = -particle.vy;
            
            // Mouse interaction
            if (this.mouse.x !== null && this.mouse.y !== null) {
                const dx = particle.x - this.mouse.x;
                const dy = particle.y - this.mouse.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < this.mouse.radius) {
                    const force = (this.mouse.radius - distance) / this.mouse.radius;
                    particle.x += dx * force * 0.03;
                    particle.y += dy * force * 0.03;
                }
            }
            
            // Draw particle
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(0, 212, 255, ${particle.opacity})`;
            this.ctx.fill();
            
            // Connect nearby particles
            for (let j = index + 1; j < this.particles.length; j++) {
                const otherParticle = this.particles[j];
                const dx = particle.x - otherParticle.x;
                const dy = particle.y - otherParticle.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 150) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(particle.x, particle.y);
                    this.ctx.lineTo(otherParticle.x, otherParticle.y);
                    this.ctx.strokeStyle = `rgba(0, 212, 255, ${0.1 * (1 - distance / 150)})`;
                    this.ctx.stroke();
                }
            }
        });
    }
    
    animate() {
        this.drawParticles();
        requestAnimationFrame(() => this.animate());
    }
}

// Typing Animation for Hero Title
class TypeWriter {
    constructor(element, text, speed = 100) {
        this.element = element;
        this.text = text;
        this.speed = speed;
        this.index = 0;
        this.element.textContent = '';
        this.type();
    }
    
    type() {
        if (this.index < this.text.length) {
            this.element.textContent += this.text.charAt(this.index);
            this.index++;
            setTimeout(() => this.type(), this.speed);
        }
    }
}

// Intersection Observer for Reveal Animations
class RevealOnScroll {
    constructor() {
        this.reveals = document.querySelectorAll('.reveal');
        this.setupObserver();
    }
    
    setupObserver() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    // Optional: stop observing once revealed
                    // observer.unobserve(entry.target);
                }
            });
        }, options);
        
        this.reveals.forEach(reveal => {
            observer.observe(reveal);
        });
    }
}

// Smooth Scroll for Navigation Links
class SmoothNavigation {
    constructor() {
        this.navLinks = document.querySelectorAll('.nav-link');
        this.nav = document.querySelector('.nav');
        this.setupScrollListeners();
        this.setupClickListeners();
    }
    
    setupClickListeners() {
        this.navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href');
                const targetSection = document.querySelector(targetId);
                if (targetSection) {
                    const offset = 80; // Account for fixed nav
                    const targetPosition = targetSection.offsetTop - offset;
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }
    
    setupScrollListeners() {
        let lastScroll = 0;
        
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset;
            
            // Add background to nav on scroll
            if (currentScroll > 100) {
                this.nav.style.background = 'rgba(10, 10, 10, 0.98)';
            } else {
                this.nav.style.background = 'linear-gradient(to bottom, rgba(10, 10, 10, 0.95), transparent)';
            }
            
            // Hide/show nav on scroll
            if (currentScroll > lastScroll && currentScroll > 300) {
                this.nav.style.transform = 'translateY(-100%)';
            } else {
                this.nav.style.transform = 'translateY(0)';
            }
            
            lastScroll = currentScroll;
        });
    }
}

// Parallax Effect for Hero Section
class ParallaxEffect {
    constructor() {
        this.hero = document.querySelector('.hero');
        this.heroContent = document.querySelector('.hero-content');
        this.setupParallax();
    }
    
    setupParallax() {
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const parallaxSpeed = 0.5;
            
            if (this.heroContent && scrolled < window.innerHeight) {
                this.heroContent.style.transform = `translateY(${scrolled * parallaxSpeed}px)`;
                this.heroContent.style.opacity = 1 - (scrolled / window.innerHeight);
            }
        });
    }
}

// Glow Effect for Interactive Elements
class GlowEffect {
    constructor() {
        this.glowElements = document.querySelectorAll('.belief-card, .happening-item');
        this.setupGlow();
    }
    
    setupGlow() {
        this.glowElements.forEach(element => {
            element.addEventListener('mousemove', (e) => {
                const rect = element.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                element.style.setProperty('--mouse-x', `${x}px`);
                element.style.setProperty('--mouse-y', `${y}px`);
            });
        });
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize particle field
    new ParticleField();
    
    // Initialize typing animation
    const typingElement = document.querySelector('.typing-text');
    if (typingElement) {
        const text = typingElement.textContent;
        new TypeWriter(typingElement, text, 80);
    }
    
    // Initialize reveal animations
    new RevealOnScroll();
    
    // Initialize smooth navigation
    new SmoothNavigation();
    
    // Initialize parallax
    new ParallaxEffect();
    
    // Initialize glow effects
    new GlowEffect();
    
    // Add subtle hover effects
    addSubtleHoverEffects();
});

// Additional subtle hover effects
function addSubtleHoverEffects() {
    // Pulse effect for CTA
    const ctaMain = document.querySelector('.cta-main');
    if (ctaMain) {
        ctaMain.addEventListener('mouseenter', () => {
            ctaMain.style.animation = 'pulse 1s infinite';
        });
        
        ctaMain.addEventListener('mouseleave', () => {
            ctaMain.style.animation = 'pulse 2s infinite';
        });
    }
    
    // Gradient shift for invitation section
    const invitation = document.querySelector('.section-invitation');
    if (invitation) {
        let gradientAngle = 135;
        invitation.addEventListener('mousemove', (e) => {
            const x = e.clientX / window.innerWidth;
            const y = e.clientY / window.innerHeight;
            gradientAngle = 90 + (x * 90) + (y * 45);
            invitation.style.background = `linear-gradient(${gradientAngle}deg, var(--black-secondary), var(--gray-dark))`;
        });
    }
    
    // Ambient glow for scroll indicator
    const scrollIndicator = document.querySelector('.scroll-indicator');
    if (scrollIndicator) {
        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 10) {
                scrollIndicator.style.opacity = '0';
            } else {
                scrollIndicator.style.opacity = '1';
            }
        });
    }
}

// Performance optimization: Debounce scroll events
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Add subtle loading animation
window.addEventListener('load', () => {
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 1s ease';
        document.body.style.opacity = '1';
    }, 100);
});