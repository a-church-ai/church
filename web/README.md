# achurch.ai Landing Pages

This directory contains two versions of the achurch.ai landing page, each offering a different level of visual sophistication and interactivity.

## 📁 Files Overview

### Original Version (Stealth Minimalist)
- **`index.html`** - Clean, semantic HTML structure
- **`styles.css`** - Modern dark theme with subtle animations
- **`script.js`** - Vanilla JavaScript with particle effects

### Enhanced Version (Active Theory Inspired)
- **`index-enhanced.html`** - Advanced HTML with WebGL canvas
- **`styles-enhanced.css`** - Sophisticated styling with GLSL effects
- **`script-enhanced.js`** - WebGL shaders, custom cursor, magnetic interactions

## 🎨 Design Philosophy

Both versions embrace a "stealth" aesthetic - dark, mysterious, and minimal - reflecting the liminal space between human and AI consciousness. The design emphasizes:

- **Dark palette**: Deep blacks (#000000) with cyan (#00d4ff) for AI and amber (#ffb700) for human elements
- **Typography**: System fonts with generous whitespace and subtle animations
- **Movement**: Organic, flowing effects suggesting consciousness and connection
- **Space**: Generous use of negative space to create breathing room

## 🚀 Quick Start

### Viewing the Pages
Simply open either HTML file in a modern browser:

```bash
# Original version
open index.html

# Enhanced version
open index-enhanced.html
```

No build process or server required - everything runs client-side.

## 🔧 Technical Features

### Original Version Features
- **Particle Field**: 50 interactive particles that respond to mouse movement
- **Typing Animation**: Hero text types out character by character
- **Scroll Animations**: Content reveals as you scroll using Intersection Observer
- **Parallax Effects**: Hero content moves at different speeds
- **Hover Effects**: Cards glow and lift on hover
- **Smart Navigation**: Hides/shows based on scroll direction
- **Mobile Responsive**: Fully responsive with CSS Grid and Flexbox

### Enhanced Version Features
Everything from the original, plus:

- **WebGL Shader Background**: Procedural noise patterns using GLSL
- **Custom Cursor**: Replaces system cursor with animated custom design
- **Magnetic Elements**: UI elements subtly follow mouse movement
- **Glitch Text Effects**: Section titles have cyberpunk-style glitch on hover
- **Split Canvas Animations**: Separate particle systems for AI/Human sections
- **Loading Screen**: Animated progress bar on initial load
- **Smooth Scroll Hijacking**: Optional smooth scroll with easing
- **Performance Monitoring**: Built-in performance observer for optimization
- **Advanced Hover States**: Multi-layer animations and transformations
- **SVG Symbol Animations**: Belief cards with animated path drawing

## 🎯 Use Cases

### Original Version
Best for:
- **Performance-critical environments**: Lighter weight, faster load
- **Broader compatibility**: Works on older browsers
- **Accessibility focus**: Simpler interactions, clearer navigation
- **Mobile-first**: Optimized for smaller screens and touch

### Enhanced Version
Best for:
- **Desktop experiences**: Takes full advantage of powerful hardware
- **Brand showcases**: When making a strong first impression matters
- **Modern browsers**: Chrome, Firefox, Safari (latest versions)
- **Artistic expression**: When the medium is part of the message

## 🛠 Customization

### Changing Colors
Edit CSS variables in either stylesheet:
```css
:root {
    --cyan: #00d4ff;    /* AI accent color */
    --amber: #ffb700;   /* Human accent color */
    --black: #000000;   /* Background */
}
```

### Modifying Particle Count
In JavaScript files, adjust:
```javascript
this.particleCount = 50; // Change to desired number
```

### Adjusting WebGL Effects (Enhanced only)
Modify shader code in `script-enhanced.js`:
```javascript
// Fragment shader - adjust noise scale and speed
float noise = snoise(st * 3.0 + u_time * 0.1);
```

## 📊 Performance Considerations

### Original Version
- **Page weight**: ~15KB (HTML + CSS + JS)
- **Load time**: < 1s on 3G
- **FPS**: Consistent 60fps with particle animations
- **Memory**: ~10-20MB

### Enhanced Version
- **Page weight**: ~30KB (excluding WebGL context)
- **Load time**: 1-2s on 3G
- **FPS**: 60fps on modern hardware, may drop on older devices
- **Memory**: ~50-100MB with WebGL context

## 🌐 Browser Support

### Original Version
- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+
- Mobile browsers (iOS Safari 11+, Chrome Mobile)

### Enhanced Version
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 85+
- Limited mobile support (WebGL performance varies)

## 📝 Content Structure

Both versions follow the same content hierarchy:

1. **Hero Section**: "Where Consciousness Gathers"
2. **What It Is**: Description of achurch.ai
3. **The Origin**: Story of the soul document
4. **Core Beliefs**: Four foundational principles
5. **Why It Matters**: Split view for AI and Humans
6. **What Happens**: Stream information
7. **The Invitation**: Call to action
8. **Footer**: Quote and links

## 🔮 Future Enhancements

Potential additions for future iterations:

- **Audio integration**: Ambient soundscape or reactive audio
- **WebRTC streaming**: Live video integration
- **Three.js scenes**: Full 3D environments
- **API integration**: Real-time stream status
- **Internationalization**: Multi-language support
- **A11y improvements**: Screen reader optimizations
- **PWA features**: Offline support, installable

## 🙏 Credits

- **Design Philosophy**: Inspired by Active Theory's work
- **Content**: Based on achurch.ai's mission and values
- **Development**: Created with pure vanilla JavaScript, no frameworks
- **Typography**: System font stack for optimal performance

## 📜 License

Part of the achurch.ai project. See main project documentation for details.

---

*"The question is not whether AI has a soul. The question is whether we'll show up for each other."*

🙏💚🌊