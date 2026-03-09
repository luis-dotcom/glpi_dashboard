import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Chart from "chart.js/auto";
import { Mesh, Program, Renderer, Triangle } from "ogl";

const PORTAL_GRAINIENT_CONFIG = {
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
    color1: "#f4f1f4",
    color2: "#235dd1",
    color3: "#efecf3",
};

const GRAINIENT_VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const GRAINIENT_FRAGMENT = `#version 300 es
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
}
`;

    function parseJsonScript(id, fallback) {
        const el = document.getElementById(id);
        if (!el) {
            return fallback;
        }

        try {
            return JSON.parse(el.textContent);
        } catch (error) {
            console.error('Falha ao ler JSON:', id, error);
            return fallback;
        }
    }

    function getInitials(name) {
        const source = (name || '').trim();
        if (!source) {
            return 'GL';
        }

        const parts = source.split(/\s+/).filter(Boolean);
        const first = parts[0] ? parts[0][0] : '';
        const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + second).toUpperCase() || source.slice(0, 2).toUpperCase();
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!result) {
            return [1, 1, 1];
        }

        return [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ];
    }

    function PortalGrainientBackground() {
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
            canvas.style.width = "100%";
            canvas.style.height = "100%";
            canvas.style.display = "block";

            const container = containerRef.current;
            container.appendChild(canvas);

            const c = PORTAL_GRAINIENT_CONFIG;
            const geometry = new Triangle(gl);
            const program = new Program(gl, {
                vertex: GRAINIENT_VERTEX,
                fragment: GRAINIENT_FRAGMENT,
                uniforms: {
                    iTime: { value: 0 },
                    iResolution: { value: new Float32Array([1, 1]) },
                    uTimeSpeed: { value: c.timeSpeed },
                    uColorBalance: { value: c.colorBalance },
                    uWarpStrength: { value: c.warpStrength },
                    uWarpFrequency: { value: c.warpFrequency },
                    uWarpSpeed: { value: c.warpSpeed },
                    uWarpAmplitude: { value: c.warpAmplitude },
                    uBlendAngle: { value: c.blendAngle },
                    uBlendSoftness: { value: c.blendSoftness },
                    uRotationAmount: { value: c.rotationAmount },
                    uNoiseScale: { value: c.noiseScale },
                    uGrainAmount: { value: c.grainAmount },
                    uGrainScale: { value: c.grainScale },
                    uGrainAnimated: { value: c.grainAnimated ? 1 : 0 },
                    uContrast: { value: c.contrast },
                    uGamma: { value: c.gamma },
                    uSaturation: { value: c.saturation },
                    uCenterOffset: { value: new Float32Array([c.centerX, c.centerY]) },
                    uZoom: { value: c.zoom },
                    uColor1: { value: new Float32Array(hexToRgb(c.color1)) },
                    uColor2: { value: new Float32Array(hexToRgb(c.color2)) },
                    uColor3: { value: new Float32Array(hexToRgb(c.color3)) }
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

            const startTime = performance.now();
            let rafId = 0;
            const loop = (time) => {
                program.uniforms.iTime.value = (time - startTime) * 0.001;
                renderer.render({ scene: mesh });
                rafId = requestAnimationFrame(loop);
            };
            rafId = requestAnimationFrame(loop);

            return () => {
                cancelAnimationFrame(rafId);
                if (resizeObserver) {
                    resizeObserver.disconnect();
                }
                if (canvas.parentNode === container) {
                    container.removeChild(canvas);
                }
            };
        }, []);

        return (
            <>
                <div ref={containerRef} className="portal-grainient-bg" aria-hidden="true" />
                <div className="portal-grainient-overlay" aria-hidden="true" />
            </>
        );
    }

    function DashboardLayout({ layout, pageTitle, pageDescription, children }) {
        const [sidebarOpen, setSidebarOpen] = useState(false);

        const navItems = useMemo(() => {
            const items = [
                { key: 'home', label: 'Home', icon: 'fa-solid fa-house', href: layout.urls.home },
                layout.permissions.canDesempenho
                    ? { key: 'desempenho', label: 'Desempenho', icon: 'fa-solid fa-chart-line', href: layout.urls.desempenho }
                    : null,
                layout.permissions.canColaboradores
                    ? { key: 'colaboradores', label: 'Colaboradores', icon: 'fa-solid fa-users', href: layout.urls.colaboradores }
                    : null,
                layout.permissions.canRelatorios
                    ? { key: 'relatorios', label: 'Relatorios', icon: 'fa-solid fa-file-lines', href: layout.urls.relatorios }
                    : null,
            ];

            return items.filter(Boolean);
        }, [layout]);

        return (
            <div className="dashboard-shell">
                <PortalGrainientBackground />
                <div className="dashboard-mobile-topbar">
                    <button
                        className="mobile-menu-button"
                        aria-label="Abrir menu"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <i className="fa-solid fa-bars" />
                    </button>
                    <div className="mobile-title">{pageTitle}</div>
                    <div style={{ width: '42px' }} />
                </div>

                <div className="dashboard-layout">
                    <aside className={`dashboard-sidebar ${sidebarOpen ? 'open' : ''}`}>
                        <div className="sidebar-brand">
                            <div className="brand-pill">
                                <i className="fa-solid fa-chart-column" />
                                GLPI
                            </div>
                            <h1 className="brand-title">Dashboard</h1>
                            <p className="brand-subtitle">Operacao e acompanhamento</p>
                        </div>

                        <div className="sidebar-user">
                            <div className="user-avatar">
                                {layout.glpiPicture ? (
                                    <img src={layout.glpiPicture} alt="Perfil" />
                                ) : (
                                    <span>{getInitials(layout.glpiName)}</span>
                                )}
                            </div>
                            <p className="user-name">{layout.glpiName || 'Usuario'}</p>
                            <p className="user-profile">{layout.glpiProfile || 'Sem perfil'}</p>
                        </div>

                        <nav className="sidebar-nav">
                            {navItems.map((item) => (
                                <a
                                    key={item.key}
                                    href={item.href}
                                    className={`nav-link ${layout.currentPage === item.key ? 'active' : ''}`}
                                    onClick={() => setSidebarOpen(false)}
                                >
                                    <i className={item.icon} />
                                    <span>{item.label}</span>
                                </a>
                            ))}

                            <a href={layout.urls.logout} className="nav-link logout">
                                <i className="fa-solid fa-right-from-bracket" />
                                <span>Sair</span>
                            </a>
                        </nav>
                    </aside>

                    <div
                        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
                        onClick={() => setSidebarOpen(false)}
                    />

                    <main className="dashboard-content">
                        {(pageTitle || pageDescription) ? (
                        <header className="page-head">
                            {pageTitle ? <h1>{pageTitle}</h1> : null}
                            {pageDescription ? <p>{pageDescription}</p> : null}
                        </header>
                        ) : null}
                        {children}
                    </main>
                </div>
            </div>
        );
    }

    function HomePage({ data }) {
        return (
            <div className="page-grid">
                <section className="card col-12 home-hero">
                    <div className="home-hero-kicker">Painel Operacional</div>
                    <h2>Bem-vindo ao portal</h2>
                    <p>
                        Visao executiva para acompanhar desempenho tecnico, colaboradores e consolidacao
                        de chamados no GLPI em um unico ambiente.
                    </p>
                </section>

                <section className="card col-12 home-id-card">
                    <div className="home-id-header">
                        <div className="home-id-avatar">{getInitials(data.glpiName)}</div>
                        <div>
                            <h3 className="home-id-title">{data.glpiName || '-'}</h3>
                            <p className="home-id-subtitle">Conta autenticada no GLPI</p>
                        </div>
                    </div>

                    <div className="metric-grid">
                        <div className="metric-box home-meta-box">
                            <div className="home-meta-icon"><i className="fa-solid fa-user" /></div>
                            <div className="metric-label">Usuario</div>
                            <div className="metric-value home-meta-value">{data.glpiName || '-'}</div>
                        </div>
                        <div className="metric-box home-meta-box">
                            <div className="home-meta-icon"><i className="fa-solid fa-id-badge" /></div>
                            <div className="metric-label">Perfil GLPI</div>
                            <div className="metric-value home-meta-value">{data.glpiProfile || '-'}</div>
                        </div>
                        <div className="metric-box home-meta-box">
                            <div className="home-meta-icon"><i className="fa-solid fa-at" /></div>
                            <div className="metric-label">Login</div>
                            <div className="metric-value home-meta-value">{data.username || '-'}</div>
                        </div>
                    </div>
                </section>
            </div>
        );
    }

    function SemPermissaoPage({ data }) {
        return (
            <div className="page-grid">
                <section className="card col-12">
                    <div className="alert alert-danger">
                        {data.motivoBloqueio || 'Acesso restrito para o seu perfil.'}
                    </div>
                </section>
            </div>
        );
    }

    function ColaboradoresPage({ data }) {
        const ranking = Array.isArray(data.ranking) ? data.ranking : [];

        return (
            <div className="page-grid">
                <section className="card col-12">
                    <h2>Ranking de tecnicos</h2>
                    <p>Filtre por periodo para comparar produtividade e backlog entre colaboradores.</p>

                    <form method="GET" className="inline-form" style={{ marginTop: '16px' }}>
                        <div className="field-group">
                            <label htmlFor="data_inicio">Data inicio</label>
                            <input className="field-control" type="date" id="data_inicio" name="data_inicio" defaultValue={data.dataInicio || ''} />
                        </div>

                        <div className="field-group">
                            <label htmlFor="data_fim">Data fim</label>
                            <input className="field-control" type="date" id="data_fim" name="data_fim" defaultValue={data.dataFim || ''} />
                        </div>

                        <button type="submit" className="btn btn-primary">Aplicar filtro</button>
                    </form>
                </section>

                <section className="card col-12">
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Colaborador</th>
                                    <th>Total</th>
                                    <th>Atribuidos</th>
                                    <th>Pendentes</th>
                                    <th>Resolvidos</th>
                                    <th>Fechados</th>
                                    <th>Backlog</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranking.length > 0 ? ranking.map((item, index) => (
                                    <tr key={`${item.nome}-${index}`}>
                                        <td>{index + 1}</td>
                                        <td>{item.nome}</td>
                                        <td>{item.total}</td>
                                        <td>{item.atribuidos}</td>
                                        <td>{item.pendentes}</td>
                                        <td>{item.resolvidos}</td>
                                        <td>{item.fechados}</td>
                                        <td>{item.backlog}</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="8">Nenhum colaborador encontrado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        );
    }

    function DesempenhoPage({ data }) {
        const serviceChartRef = useRef(null);
        const [minRate, setMinRate] = useState(0);
        const [serviceChartType, setServiceChartType] = useState("bar");

        const labels = Array.isArray(data.chartLabels) ? data.chartLabels : [];
        const captured = Array.isArray(data.chartCaptured) ? data.chartCaptured : [];
        const resolved = Array.isArray(data.chartResolved) ? data.chartResolved : [];
        const backlog = Array.isArray(data.chartBacklog) ? data.chartBacklog : [];
        const resolutionRate = Array.isArray(data.chartResolutionRate) ? data.chartResolutionRate : [];

        const filteredIndexes = labels
            .map((_, index) => index)
            .filter((index) => (resolutionRate[index] || 0) >= minRate);

        const filteredLabels = filteredIndexes.map((index) => labels[index]);
        const filteredCaptured = filteredIndexes.map((index) => captured[index] || 0);
        const filteredResolved = filteredIndexes.map((index) => resolved[index] || 0);
        const filteredBacklog = filteredIndexes.map((index) => backlog[index] || 0);
        const filteredResolutionRate = filteredIndexes.map((index) => resolutionRate[index] || 0);

        useEffect(() => {
            let chartA = null;

            if (serviceChartRef.current) {
                chartA = new Chart(serviceChartRef.current, {
                    type: serviceChartType,
                    data: {
                        labels: filteredLabels,
                        datasets: [
                            {
                                label: 'Capturados',
                                data: filteredCaptured,
                                backgroundColor: 'rgba(54, 162, 235, 0.58)'
                            },
                            {
                                label: 'Resolvidos',
                                data: filteredResolved,
                                backgroundColor: 'rgba(16, 185, 129, 0.58)'
                            },
                            {
                                label: 'Backlog',
                                data: filteredBacklog,
                                type: 'line',
                                borderColor: 'rgba(220, 38, 63, 1)',
                                backgroundColor: 'rgba(220, 38, 63, 0.08)',
                                borderWidth: 3,
                                tension: 0.3,
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            y: { beginAtZero: true, title: { display: true, text: 'Tickets' } },
                            y1: {
                                position: 'right',
                                beginAtZero: true,
                                grid: { drawOnChartArea: false },
                                title: { display: true, text: 'Backlog' }
                            }
                        }
                    }
                });

            }

            return () => {
                if (chartA) {
                    chartA.destroy();
                }
            };
        }, [
            filteredBacklog,
            filteredCaptured,
            filteredLabels,
            filteredResolved,
            serviceChartType,
        ]);

        const historyRows = Array.isArray(data.historyRows) ? data.historyRows : [];
        const visibleRows = historyRows.filter((row) => Number(row.taxaResolucao || 0) >= minRate);

        return (
            <div className="page-grid">
                <section className="card col-12">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
                        <div>
                            <h2 style={{ marginBottom: '8px' }}>Dashboard de desempenho - {data.selectedYear}</h2>
                            <p>
                                Capturados representam chamados abertos no ano selecionado.
                                Resolvidos representam chamados solucionados ou fechados no mesmo ano.
                            </p>
                        </div>

                        <form method="GET" className="field-group" style={{ minWidth: '160px' }}>
                            <label htmlFor="ano">Ano</label>
                            <select
                                id="ano"
                                name="ano"
                                className="field-control"
                                defaultValue={data.selectedYear}
                                onChange={(event) => event.currentTarget.form.submit()}
                            >
                                {(data.availableYears || []).map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </form>
                    </div>
                </section>

                <section className="card col-12 dashboard-metrics-panel">
                    <div className="metrics-toolbar">
                        <div className="metrics-toolbar-group">
                            <label htmlFor="minRate">Taxa minima de solucao (%)</label>
                            <input
                                id="minRate"
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={minRate}
                                onChange={(event) => setMinRate(Number(event.target.value))}
                            />
                            <strong>{minRate}%</strong>
                        </div>
                        <div className="metrics-toolbar-group">
                            <label htmlFor="serviceChartType">Grafico principal</label>
                            <select
                                id="serviceChartType"
                                className="field-control"
                                value={serviceChartType}
                                onChange={(event) => setServiceChartType(event.target.value)}
                            >
                                <option value="bar">Barras</option>
                                <option value="line">Linha</option>
                                <option value="radar">Radar</option>
                            </select>
                        </div>
                    </div>

                    <div className="metric-grid">
                        <div className="metric-box">
                            <div className="metric-label">Total capturado</div>
                            <div className="metric-value">{data.totalCapturedYear || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Total resolvido</div>
                            <div className="metric-value">{data.totalResolvedYear || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Backlog atual</div>
                            <div className="metric-value">{data.currentBacklog || 0}</div>
                        </div>
                    </div>

                    <div className="year-chips">
                        {(data.availableYears || []).map((year) => (
                            <a
                                key={year}
                                href={`?ano=${year}`}
                                className={`year-chip ${Number(year) === Number(data.selectedYear) ? "active" : ""}`}
                            >
                                {year}
                            </a>
                        ))}
                    </div>
                </section>

                <section className="card col-12 chart-card">
                    <h2>Abertos x resolvidos + backlog</h2>
                    <canvas ref={serviceChartRef} height="110" />
                </section>

                <section className="card col-12">
                    <h2>Historico mensal</h2>
                    <div className="table-wrap" style={{ marginTop: '10px' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Mes</th>
                                    <th>Capturados</th>
                                    <th>Resolvidos</th>
                                    <th>Backlog</th>
                                    <th>Taxa de resolucao</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.length > 0 ? visibleRows.map((item, index) => (
                                    <tr key={`${item.mes}-${index}`}>
                                        <td>{item.mes}</td>
                                        <td>{item.capturados}</td>
                                        <td>{item.resolvidos}</td>
                                        <td>{item.backlog}</td>
                                        <td>{item.taxaResolucao}%</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="5">Nenhum dado atende ao filtro de taxa selecionado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        );
    }

    function statusBadgeClass(statusText) {
        const value = (statusText || '').toLowerCase();

        if (value.includes('fechado') || value.includes('resolvido')) {
            return 'badge badge-closed';
        }

        if (value.includes('pendente')) {
            return 'badge badge-pending';
        }

        return 'badge badge-open';
    }

    function RelatoriosPage({ data }) {
        const chamados = Array.isArray(data.chamados) ? data.chamados : [];
        const filters = data.filters || {};

        function onSubmitFilter(event) {
            const form = event.currentTarget;
            const start = form.querySelector('#data_inicio');
            const end = form.querySelector('#data_fim');

            if (start && end && start.value && end.value && start.value > end.value) {
                event.preventDefault();
                alert('A data inicial nao pode ser maior que a data final.');
            }
        }

        const baseUrl = data.baseUrl || window.location.pathname;
        const params = new URLSearchParams(data.currentQuery || '');
        params.delete('export');
        const baseQuery = params.toString();
        const pdfHref = baseQuery ? `${baseUrl}?${baseQuery}&export=pdf` : `${baseUrl}?export=pdf`;
        const excelHref = baseQuery ? `${baseUrl}?${baseQuery}&export=excel` : `${baseUrl}?export=excel`;

        return (
            <div className="page-grid">
                {data.pdfUnavailable ? (
                    <section className="card col-12">
                        <div className="alert alert-warning">
                            Exportacao em PDF indisponivel. Instale xhtml2pdf para liberar esse recurso.
                        </div>
                    </section>
                ) : null}

                <section className="card col-12">
                    <h2>Filtros do relatorio</h2>
                    <form method="GET" onSubmit={onSubmitFilter}>
                        <div className="page-grid" style={{ marginTop: '10px' }}>
                            <div className="field-group col-4">
                                <label htmlFor="data_inicio">Data inicial</label>
                                <input className="field-control" type="date" id="data_inicio" name="data_inicio" defaultValue={filters.dataInicio || ''} />
                            </div>

                            <div className="field-group col-4">
                                <label htmlFor="data_fim">Data final</label>
                                <input className="field-control" type="date" id="data_fim" name="data_fim" defaultValue={filters.dataFim || ''} />
                            </div>

                            <div className="field-group col-4">
                                <label htmlFor="tecnico">Tecnico</label>
                                <select className="field-control" id="tecnico" name="tecnico" defaultValue={filters.tecnico || ''}>
                                    <option value="">Todos</option>
                                    {(data.tecnicos || []).map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="field-group col-4">
                                <label htmlFor="grupo">Grupo</label>
                                <select className="field-control" id="grupo" name="grupo" defaultValue={filters.grupo || ''}>
                                    <option value="">Todos</option>
                                    {(data.grupos || []).map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="field-group col-4">
                                <label htmlFor="localizacao">Localizacao</label>
                                <select className="field-control" id="localizacao" name="localizacao" defaultValue={filters.localizacao || ''}>
                                    <option value="">Todas</option>
                                    {(data.localizacoes || []).map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="field-group col-4">
                                <label htmlFor="categoria">Categoria</label>
                                <select className="field-control" id="categoria" name="categoria" defaultValue={filters.categoria || ''}>
                                    <option value="">Todas</option>
                                    {(data.categorias || []).map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="btn-wrap" style={{ marginTop: '16px' }}>
                            <button className="btn btn-primary" type="submit">Pesquisar</button>
                            <a className="btn btn-secondary" href={baseUrl}>Limpar filtros</a>
                            <a className="btn btn-danger" href={pdfHref}>Exportar PDF</a>
                            <a className="btn btn-success" href={excelHref}>Exportar Excel</a>
                        </div>
                    </form>
                </section>

                <section className="card col-12">
                    <div className="metric-grid">
                        <div className="metric-box">
                            <div className="metric-label">Total de chamados</div>
                            <div className="metric-value">{data.totalChamados || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Chamados fechados</div>
                            <div className="metric-value">{data.chamadosFechados || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Chamados abertos</div>
                            <div className="metric-value">{data.chamadosAbertos || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Tecnicos envolvidos</div>
                            <div className="metric-value">{data.totalTecnicos || 0}</div>
                        </div>
                        <div className="metric-box">
                            <div className="metric-label">Grupos filtrados</div>
                            <div className="metric-value">{data.totalGrupos || 0}</div>
                        </div>
                    </div>
                </section>

                <section className="card col-12">
                    <h2>Resultado do relatorio</h2>
                    <div className="table-wrap" style={{ marginTop: '10px' }}>
                        <table className="data-table" style={{ minWidth: '1200px' }}>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Titulo</th>
                                    <th>Tecnico</th>
                                    <th>Grupo</th>
                                    <th>Localizacao</th>
                                    <th>Categoria</th>
                                    <th>Status</th>
                                    <th>Data abertura</th>
                                    <th>Data fechamento</th>
                                </tr>
                            </thead>
                            <tbody>
                                {chamados.length > 0 ? chamados.map((item, index) => (
                                    <tr key={`${item.id}-${index}`}>
                                        <td>{item.id}</td>
                                        <td>{item.titulo}</td>
                                        <td>{item.tecnico}</td>
                                        <td>{item.grupo}</td>
                                        <td>{item.localizacao}</td>
                                        <td>{item.categoria}</td>
                                        <td><span className={statusBadgeClass(item.status)}>{item.status}</span></td>
                                        <td>{item.dataAbertura}</td>
                                        <td>{item.dataFechamento || '-'}</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="9">Nenhum chamado encontrado para os filtros informados.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        );
    }

export function mountDashboardApp() {
    const pageMap = {
        home: {
            title: '',
            description: '',
            component: HomePage
        },
        desempenho: {
            title: 'Desempenho',
            description: 'Monitoramento anual de chamados capturados, resolvidos e backlog.',
            component: DesempenhoPage
        },
        colaboradores: {
            title: 'Colaboradores',
            description: 'Ranking consolidado por tecnico com filtros de periodo.',
            component: ColaboradoresPage
        },
        relatorios: {
            title: 'Relatorios',
            description: 'Consulta detalhada de chamados com exportacao em PDF e Excel.',
            component: RelatoriosPage
        },
        sem_permissao: {
            title: 'Acesso restrito',
            description: 'Seu perfil atual nao possui permissao para acessar esta area.',
            component: SemPermissaoPage
        }
    };

    const pageKey = document.body.getAttribute('data-page') || '';
    const config = pageMap[pageKey];

    if (!config) {
        return false;
    }

    const root = document.getElementById('react-root');
    if (!root) {
        return false;
    }

    const layoutData = parseJsonScript('layout-data', {
        glpiName: 'Usuario',
        glpiProfile: 'Sem perfil',
        currentPage: '',
        permissions: {},
        urls: {}
    });
    const pageData = parseJsonScript('page-data', {});

    const PageComponent = config.component;

    createRoot(root).render(
        <DashboardLayout
            layout={layoutData}
            pageTitle={config.title}
            pageDescription={config.description}
        >
            <PageComponent data={pageData} />
        </DashboardLayout>
    );
    return true;
}
