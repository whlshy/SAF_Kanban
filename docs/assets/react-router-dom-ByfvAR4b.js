import{a as s,R as w}from"./react-CwX5eVBo.js";import"./react-dom-kZ0iOKLp.js";import{l as T,R as v,u as U,a as g}from"./react-router-DsvEsCKM.js";import{c as y}from"./@remix-run-tn2ilB4G.js";/**
 * React Router DOM v6.30.3
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */function f(e){return e===void 0&&(e=""),new URLSearchParams(typeof e=="string"||Array.isArray(e)||e instanceof URLSearchParams?e:Object.keys(e).reduce((c,t)=>{let r=e[t];return c.concat(Array.isArray(r)?r.map(a=>[t,a]):[[t,r]])},[]))}function E(e,c){let t=f(e);return c&&c.forEach((r,a)=>{t.has(a)||c.getAll(a).forEach(o=>{t.append(a,o)})}),t}const F="6";try{window.__reactRouterVersion=F}catch{}const P="startTransition",S=w[P];function L(e){let{basename:c,children:t,future:r,window:a}=e,o=s.useRef();o.current==null&&(o.current=y({window:a,v5Compat:!0}));let n=o.current,[u,i]=s.useState({action:n.action,location:n.location}),{v7_startTransition:l}=r||{},h=s.useCallback(m=>{l&&S?S(()=>i(m)):i(m)},[i,l]);return s.useLayoutEffect(()=>n.listen(h),[n,h]),s.useEffect(()=>T(r),[r]),s.createElement(v,{basename:c,children:t,location:u.location,navigationType:u.action,navigator:n,future:r})}var R;(function(e){e.UseScrollRestoration="useScrollRestoration",e.UseSubmit="useSubmit",e.UseSubmitFetcher="useSubmitFetcher",e.UseFetcher="useFetcher",e.useViewTransitionState="useViewTransitionState"})(R||(R={}));var p;(function(e){e.UseFetcher="useFetcher",e.UseFetchers="useFetchers",e.UseScrollRestoration="useScrollRestoration"})(p||(p={}));function V(e){let c=s.useRef(f(e)),t=s.useRef(!1),r=U(),a=s.useMemo(()=>E(r.search,t.current?null:c.current),[r.search]),o=g(),n=s.useCallback((u,i)=>{const l=f(typeof u=="function"?u(a):u);t.current=!0,o("?"+l,i)},[o,a]);return[a,n]}export{L as B,V as u};
