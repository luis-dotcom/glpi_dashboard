import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mesh, Program, Renderer, Triangle } from "ogl";

    const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

    const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);} 
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);} 
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);
  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;
  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);
  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));
  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);} 
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;
  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}`;

    const config = {
        timeSpeed: 0.3,
        colorBalance: 0.0,
        warpStrength: 1.0,
        warpFrequency: 5.0,
        warpSpeed: 2.0,
        warpAmplitude: 50.0,
        blendAngle: 0.0,
        blendSoftness: 0.05,
        rotationAmount: 500.0,
        noiseScale: 2.0,
        grainAmount: 0.1,
        grainScale: 2.0,
        grainAnimated: false,
        contrast: 1.5,
        gamma: 1.0,
        saturation: 1.0,
        centerX: 0.0,
        centerY: 0.0,
        zoom: 0.9,
        color1: '#f4f1f4',
        color2: '#235dd1',
        color3: '#efecf3'
    };

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        if (!result) {
            return [1, 1, 1];
        }

        return [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ];
    }

    function parseJson(id, fallback) {
        const el = document.getElementById(id);
        if (!el) {
            return fallback;
        }

        try {
            return JSON.parse(el.textContent);
        } catch (error) {
            console.error('JSON invalido:', id, error);
            return fallback;
        }
    }

    function GrainientBackground() {
        const containerRef = useRef(null);

        useEffect(() => {
            if (!containerRef.current || !window.WebGL2RenderingContext) {
                return;
            }

            const renderer = new Renderer({
                webgl: 2,
                alpha: true,
                antialias: false,
                dpr: Math.min(window.devicePixelRatio || 1, 2)
            });

            const gl = renderer.gl;
            const canvas = gl.canvas;
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';

            const container = containerRef.current;
            container.appendChild(canvas);

            const geometry = new Triangle(gl);
            const program = new Program(gl, {
                vertex,
                fragment,
                uniforms: {
                    iTime: { value: 0 },
                    iResolution: { value: new Float32Array([1, 1]) },
                    uTimeSpeed: { value: config.timeSpeed },
                    uColorBalance: { value: config.colorBalance },
                    uWarpStrength: { value: config.warpStrength },
                    uWarpFrequency: { value: config.warpFrequency },
                    uWarpSpeed: { value: config.warpSpeed },
                    uWarpAmplitude: { value: config.warpAmplitude },
                    uBlendAngle: { value: config.blendAngle },
                    uBlendSoftness: { value: config.blendSoftness },
                    uRotationAmount: { value: config.rotationAmount },
                    uNoiseScale: { value: config.noiseScale },
                    uGrainAmount: { value: config.grainAmount },
                    uGrainScale: { value: config.grainScale },
                    uGrainAnimated: { value: config.grainAnimated ? 1 : 0 },
                    uContrast: { value: config.contrast },
                    uGamma: { value: config.gamma },
                    uSaturation: { value: config.saturation },
                    uCenterOffset: { value: new Float32Array([config.centerX, config.centerY]) },
                    uZoom: { value: config.zoom },
                    uColor1: { value: new Float32Array(hexToRgb(config.color1)) },
                    uColor2: { value: new Float32Array(hexToRgb(config.color2)) },
                    uColor3: { value: new Float32Array(hexToRgb(config.color3)) }
                }
            });

            const mesh = new Mesh(gl, { geometry, program });

            const setSize = () => {
                const rect = container.getBoundingClientRect();
                const width = Math.max(1, Math.floor(rect.width));
                const height = Math.max(1, Math.floor(rect.height));
                renderer.setSize(width, height);
                program.uniforms.iResolution.value[0] = gl.drawingBufferWidth;
                program.uniforms.iResolution.value[1] = gl.drawingBufferHeight;
            };

            const resizeObserver = window.ResizeObserver ? new ResizeObserver(setSize) : null;
            if (resizeObserver) {
                resizeObserver.observe(container);
            }
            setSize();

            const start = performance.now();
            let raf = 0;

            const loop = (time) => {
                program.uniforms.iTime.value = (time - start) * 0.001;
                renderer.render({ scene: mesh });
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);

            return () => {
                cancelAnimationFrame(raf);
                if (resizeObserver) {
                    resizeObserver.disconnect();
                }
                if (canvas.parentNode === container) {
                    container.removeChild(canvas);
                }
            };
        }, []);

        return <div ref={containerRef} className="login-grainient" aria-hidden="true" />;
    }

    function LoginApp({ data }) {
        const [showPassword, setShowPassword] = useState(false);
        const messages = Array.isArray(data.messages) ? data.messages : [];

        return (
            <>
                <GrainientBackground />
                <div className="login-overlay" aria-hidden="true" />

                <main className="login-shell">
                    <section className="login-card">
                        <span className="login-badge">
                            <i className="fa-solid fa-lock" />
                            GLPI Dashboard
                        </span>

                        <h1 className="login-title">Sistema</h1>
                        <p className="login-subtitle">Acesse com seu usuario do GLPI</p>

                        {messages.map((message, index) => (
                            <div key={`msg-${index}`} className="login-alert error">{message}</div>
                        ))}

                        <form method="POST" noValidate>
                            <input type="hidden" name="csrfmiddlewaretoken" value={data.csrfToken || ''} />

                            <div className="form-group">
                                <label className="form-label" htmlFor="id_username">Usuario</label>
                                <input
                                    className="form-input"
                                    type="text"
                                    id="id_username"
                                    name="username"
                                    defaultValue={data.usernameValue || ''}
                                    placeholder="Digite seu usuario"
                                    autoComplete="username"
                                />
                                {data.usernameError ? <div className="field-error">{data.usernameError}</div> : null}
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="id_password">Senha</label>
                                <div className="password-wrap">
                                    <input
                                        className="form-input"
                                        type={showPassword ? 'text' : 'password'}
                                        id="id_password"
                                        name="password"
                                        defaultValue={data.passwordValue || ''}
                                        placeholder="Digite sua senha"
                                        autoComplete="current-password"
                                    />
                                    <button
                                        className="password-toggle"
                                        type="button"
                                        onClick={() => setShowPassword((value) => !value)}
                                    >
                                        {showPassword ? 'Ocultar' : 'Mostrar'}
                                    </button>
                                </div>
                                {data.passwordError ? <div className="field-error">{data.passwordError}</div> : null}
                            </div>

                            <button type="submit" className="submit-button">Entrar</button>
                        </form>
                    </section>
                </main>
            </>
        );
    }

export function mountLoginApp() {
    const root = document.getElementById('react-login-root');
    if (!root) {
        return false;
    }

    const data = parseJson('login-data', {});
    createRoot(root).render(<LoginApp data={data} />);
    return true;
}
