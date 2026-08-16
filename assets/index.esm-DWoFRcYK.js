import{r as S,_ as k,C as A,a as x,E as oe,o as j,F as xe,v as je,i as $e,b as qe,g as ae,c as Le,d as I}from"./firebase-IW9tbrMW.js";import"./index-Sg4pPAB0.js";const se="@firebase/installations",$="0.6.23";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ce=1e4,ue=`w:${$}`,de="FIS_v2",He="https://firebaseinstallations.googleapis.com/v1",Be=3600*1e3,Ve="installations",Ue="Installations";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const We={"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"not-registered":"Firebase Installation is not registered.","installation-not-found":"Firebase Installation not found.","request-failed":'{$requestName} request failed with error "{$serverCode} {$serverStatus}: {$serverMessage}"',"app-offline":"Could not process request. Application offline.","delete-pending-registration":"Can't delete installation while there is a pending registration request."},g=new oe(Ve,Ue,We);function fe(e){return e instanceof xe&&e.code.includes("request-failed")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function le({projectId:e}){return`${He}/projects/${e}/installations`}function pe(e){return{token:e.token,requestStatus:2,expiresIn:Je(e.expiresIn),creationTime:Date.now()}}async function ge(e,t){const i=(await t.json()).error;return g.create("request-failed",{requestName:e,serverCode:i.code,serverMessage:i.message,serverStatus:i.status})}function he({apiKey:e}){return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e})}function Ge(e,{refreshToken:t}){const n=he(e);return n.append("Authorization",ze(t)),n}async function we(e){const t=await e();return t.status>=500&&t.status<600?e():t}function Je(e){return Number(e.replace("s","000"))}function ze(e){return`${de} ${e}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Ye({appConfig:e,heartbeatServiceProvider:t},{fid:n}){const i=le(e),r=he(e),o=t.getImmediate({optional:!0});if(o){const s=await o.getHeartbeatsHeader();s&&r.append("x-firebase-client",s)}const a={fid:n,authVersion:de,appId:e.appId,sdkVersion:ue},c={method:"POST",headers:r,body:JSON.stringify(a)},d=await we(()=>fetch(i,c));if(d.ok){const s=await d.json();return{fid:s.fid||n,registrationStatus:2,refreshToken:s.refreshToken,authToken:pe(s.authToken)}}else throw await ge("Create Installation",d)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function be(e){return new Promise(t=>{setTimeout(t,e)})}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Qe(e){return btoa(String.fromCharCode(...e)).replace(/\+/g,"-").replace(/\//g,"_")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Xe=/^[cdef][\w-]{21}$/,P="";function Ze(){try{const e=new Uint8Array(17);(self.crypto||self.msCrypto).getRandomValues(e),e[0]=112+e[0]%16;const n=et(e);return Xe.test(n)?n:P}catch{return P}}function et(e){return Qe(e).substr(0,22)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function m(e){return`${e.appName}!${e.appId}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const b=new Map;function ye(e,t){const n=m(e);me(n,t),it(n,t)}function tt(e,t){Te();const n=m(e);let i=b.get(n);i||(i=new Set,b.set(n,i)),i.add(t)}function nt(e,t){const n=m(e),i=b.get(n);i&&(i.delete(t),i.size===0&&b.delete(n),Ie())}function me(e,t){const n=b.get(e);if(n)for(const i of n)i(t)}function it(e,t){const n=Te();n&&n.postMessage({key:e,fid:t}),Ie()}let p=null;function Te(){return!p&&"BroadcastChannel"in self&&(p=new BroadcastChannel("[Firebase] FID Change"),p.onmessage=e=>{me(e.data.key,e.data.fid)}),p}function Ie(){b.size===0&&p&&(p.close(),p=null)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const rt="firebase-installations-database",ot=1,h="firebase-installations-store";let O=null;function q(){return O||(O=j(rt,ot,{upgrade:(e,t)=>{switch(t){case 0:e.createObjectStore(h)}}})),O}async function E(e,t){const n=m(e),r=(await q()).transaction(h,"readwrite"),o=r.objectStore(h),a=await o.get(n);return await o.put(t,n),await r.done,(!a||a.fid!==t.fid)&&ye(e,t.fid),t}async function Se(e){const t=m(e),i=(await q()).transaction(h,"readwrite");await i.objectStore(h).delete(t),await i.done}async function v(e,t){const n=m(e),r=(await q()).transaction(h,"readwrite"),o=r.objectStore(h),a=await o.get(n),c=t(a);return c===void 0?await o.delete(n):await o.put(c,n),await r.done,c&&(!a||a.fid!==c.fid)&&ye(e,c.fid),c}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function L(e){let t;const n=await v(e.appConfig,i=>{const r=at(i),o=st(e,r);return t=o.registrationPromise,o.installationEntry});return n.fid===P?{installationEntry:await t}:{installationEntry:n,registrationPromise:t}}function at(e){const t=e||{fid:Ze(),registrationStatus:0};return ke(t)}function st(e,t){if(t.registrationStatus===0){if(!navigator.onLine){const r=Promise.reject(g.create("app-offline"));return{installationEntry:t,registrationPromise:r}}const n={fid:t.fid,registrationStatus:1,registrationTime:Date.now()},i=ct(e,n);return{installationEntry:n,registrationPromise:i}}else return t.registrationStatus===1?{installationEntry:t,registrationPromise:ut(e)}:{installationEntry:t}}async function ct(e,t){try{const n=await Ye(e,t);return E(e.appConfig,n)}catch(n){throw fe(n)&&n.customData.serverCode===409?await Se(e.appConfig):await E(e.appConfig,{fid:t.fid,registrationStatus:0}),n}}async function ut(e){let t=await U(e.appConfig);for(;t.registrationStatus===1;)await be(100),t=await U(e.appConfig);if(t.registrationStatus===0){const{installationEntry:n,registrationPromise:i}=await L(e);return i||n}return t}function U(e){return v(e,t=>{if(!t)throw g.create("installation-not-found");return ke(t)})}function ke(e){return dt(e)?{fid:e.fid,registrationStatus:0}:e}function dt(e){return e.registrationStatus===1&&e.registrationTime+ce<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function ft({appConfig:e,heartbeatServiceProvider:t},n){const i=lt(e,n),r=Ge(e,n),o=t.getImmediate({optional:!0});if(o){const s=await o.getHeartbeatsHeader();s&&r.append("x-firebase-client",s)}const a={installation:{sdkVersion:ue,appId:e.appId}},c={method:"POST",headers:r,body:JSON.stringify(a)},d=await we(()=>fetch(i,c));if(d.ok){const s=await d.json();return pe(s)}else throw await ge("Generate Auth Token",d)}function lt(e,{fid:t}){return`${le(e)}/${t}/authTokens:generate`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function H(e,t=!1){let n;const i=await v(e.appConfig,o=>{if(!Ae(o))throw g.create("not-registered");const a=o.authToken;if(!t&&ht(a))return o;if(a.requestStatus===1)return n=pt(e,t),o;{if(!navigator.onLine)throw g.create("app-offline");const c=bt(o);return n=gt(e,c),c}});return n?await n:i.authToken}async function pt(e,t){let n=await W(e.appConfig);for(;n.authToken.requestStatus===1;)await be(100),n=await W(e.appConfig);const i=n.authToken;return i.requestStatus===0?H(e,t):i}function W(e){return v(e,t=>{if(!Ae(t))throw g.create("not-registered");const n=t.authToken;return yt(n)?{...t,authToken:{requestStatus:0}}:t})}async function gt(e,t){try{const n=await ft(e,t),i={...t,authToken:n};return await E(e.appConfig,i),n}catch(n){if(fe(n)&&(n.customData.serverCode===401||n.customData.serverCode===404))await Se(e.appConfig);else{const i={...t,authToken:{requestStatus:0}};await E(e.appConfig,i)}throw n}}function Ae(e){return e!==void 0&&e.registrationStatus===2}function ht(e){return e.requestStatus===2&&!wt(e)}function wt(e){const t=Date.now();return t<e.creationTime||e.creationTime+e.expiresIn<t+Be}function bt(e){const t={requestStatus:1,requestTime:Date.now()};return{...e,authToken:t}}function yt(e){return e.requestStatus===1&&e.requestTime+ce<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function mt(e){const t=e,{installationEntry:n,registrationPromise:i}=await L(t);return i?i.catch(console.error):H(t).catch(console.error),n.fid}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Tt(e,t=!1){const n=e;return await It(n),(await H(n,t)).token}async function It(e){const{registrationPromise:t}=await L(e);t&&await t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function St(e,t){const{appConfig:n}=e;return tt(n,t),()=>{nt(n,t)}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function kt(e){if(!e||!e.options)throw D("App Configuration");if(!e.name)throw D("App Name");const t=["projectId","apiKey","appId"];for(const n of t)if(!e.options[n])throw D(n);return{appName:e.name,projectId:e.options.projectId,apiKey:e.options.apiKey,appId:e.options.appId}}function D(e){return g.create("missing-app-config-values",{valueName:e})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ee="installations",At="installations-internal",Et=e=>{const t=e.getProvider("app").getImmediate(),n=kt(t),i=x(t,"heartbeat");return{app:t,appConfig:n,heartbeatServiceProvider:i,_delete:()=>Promise.resolve()}},vt=e=>{const t=e.getProvider("app").getImmediate(),n=x(t,Ee).getImmediate();return{getId:()=>mt(n),getToken:r=>Tt(n,r)}};function _t(){k(new A(Ee,Et,"PUBLIC")),k(new A(At,vt,"PRIVATE"))}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */_t();S(se,$);S(se,$,"esm2020");/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Rt="/firebase-messaging-sw.js",Ct="/firebase-cloud-messaging-push-scope",ve="BDOU99-h67HcA6JeFXHbSNMu7e2yNNu3RzoMj8TM4W88jITfq7ZmPvIM1Iv-4_l2LxQcYwhqby2xGpWwzjfAnG4",Nt="https://fcmregistrations.googleapis.com/v1",_e="google.c.a.c_id",Ot="google.c.a.c_l",Dt="google.c.a.ts",Ft="google.c.a.e",G=1e4;var J;(function(e){e[e.DATA_MESSAGE=1]="DATA_MESSAGE",e[e.DISPLAY_NOTIFICATION=3]="DISPLAY_NOTIFICATION"})(J||(J={}));/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */var y;(function(e){e.PUSH_RECEIVED="push-received",e.NOTIFICATION_CLICKED="notification-clicked",e.FID_REGISTERED="fid-registered"})(y||(y={}));/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function f(e){const t=new Uint8Array(e);return btoa(String.fromCharCode(...t)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}function Re(e){const t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/\-/g,"+").replace(/_/g,"/"),i=atob(n),r=new Uint8Array(i.length);for(let o=0;o<i.length;++o)r[o]=i.charCodeAt(o);return r}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const F="fcm_token_details_db",Mt=5,z="fcm_token_object_Store";async function Pt(e){if("databases"in indexedDB&&!(await indexedDB.databases()).map(o=>o.name).includes(F))return null;let t=null;return(await j(F,Mt,{upgrade:async(i,r,o,a)=>{if(r<2||!i.objectStoreNames.contains(z))return;const c=a.objectStore(z),d=await c.index("fcmSenderId").get(e);if(await c.clear(),!!d){if(r===2){const s=d;if(!s.auth||!s.p256dh||!s.endpoint)return;t={token:s.fcmToken,createTime:s.createTime??Date.now(),subscriptionOptions:{auth:s.auth,p256dh:s.p256dh,endpoint:s.endpoint,swScope:s.swScope,vapidKey:typeof s.vapidKey=="string"?s.vapidKey:f(s.vapidKey)}}}else if(r===3){const s=d;t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:f(s.auth),p256dh:f(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:f(s.vapidKey)}}}else if(r===4){const s=d;t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:f(s.auth),p256dh:f(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:f(s.vapidKey)}}}}}})).close(),await I(F),await I("fcm_vapid_details_db"),await I("undefined"),Kt(t)?t:null}function Kt(e){if(!e||!e.subscriptionOptions)return!1;const{subscriptionOptions:t}=e;return typeof e.createTime=="number"&&e.createTime>0&&typeof e.token=="string"&&e.token.length>0&&typeof t.auth=="string"&&t.auth.length>0&&typeof t.p256dh=="string"&&t.p256dh.length>0&&typeof t.endpoint=="string"&&t.endpoint.length>0&&typeof t.swScope=="string"&&t.swScope.length>0&&typeof t.vapidKey=="string"&&t.vapidKey.length>0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const xt={"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"only-available-in-window":"This method is available in a Window context.","only-available-in-sw":"This method is available in a service worker context.","permission-default":"The notification permission was not granted and dismissed instead.","permission-blocked":"The notification permission was not granted and blocked instead.","unsupported-browser":"This browser doesn't support the API's required to use the Firebase SDK.","indexed-db-unsupported":"This browser doesn't support indexedDb.open() (ex. Safari iFrame, Firefox Private Browsing, etc)","failed-service-worker-registration":"We are unable to register the default service worker. {$browserErrorMessage}","token-subscribe-failed":"A problem occurred while subscribing the user to FCM: {$errorInfo}","token-subscribe-no-token":"FCM returned no token when subscribing the user to push.","fid-registration-failed":"A problem occurred while creating an FCM registration via FID: {$errorInfo}","fid-unregister-failed":"A problem occurred while unregistering the FCM registration via FID: {$errorInfo}","fid-registration-idb-schema-unavailable":"Unable to read or persist FID registration metadata because the messaging IndexedDB schema is unavailable (for example, the database could not be upgraded to the latest version).","token-unsubscribe-failed":"A problem occurred while unsubscribing the user from FCM: {$errorInfo}","token-update-failed":"A problem occurred while updating the user from FCM: {$errorInfo}","token-update-no-token":"FCM returned no token when updating the user to push.","use-sw-after-get-token":"The useServiceWorker() method may only be called once and must be called before calling getToken() to ensure your service worker is used.","invalid-sw-registration":"The input to useServiceWorker() must be a ServiceWorkerRegistration.","invalid-bg-handler":"The input to setBackgroundMessageHandler() must be a function.","invalid-vapid-key":"The public VAPID key must be a string.","use-vapid-key-after-get-token":"The usePublicVapidKey() method may only be called once and must be called before calling getToken() to ensure your VAPID key is used.","invalid-on-registered-handler":"No onRegistered callback handler was provided or registered. Implement onRegistered() before register()."},u=new oe("messaging","Messaging",xt);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Y="firebase-messaging-database",Q=2,w="firebase-messaging-store",l="firebase-messaging-fid-registration-store",jt={openDB:j,deleteDB:I};let X=jt,T=null;function $t(e,t,n){switch(t){case 0:if(e.createObjectStore(w),n===1)break;case 1:n===2&&e.createObjectStore(l)}}function Z(e){return{upgrade:(t,n)=>{$t(t,n,e)},blocked:()=>{},blocking:(t,n,i)=>{var r;T=null,(r=i.target)==null||r.close()},terminated:()=>{T=null}}}function _(){return T||(T=X.openDB(Y,Q,Z(2)).catch(()=>X.openDB(Y,Q-1,Z(1)))),T}function Ce(e,t){return e.objectStoreNames.contains(t)}function Ne(e){if(!Ce(e,l))throw u.create("fid-registration-idb-schema-unavailable")}async function qt(e){const t=R(e),i=await(await _()).transaction(w).objectStore(w).get(t);if(i)return i;{const r=await Pt(e.appConfig.senderId);if(r)return await B(e,r),r}}async function B(e,t){const n=R(e),i=await _(),r=[w],o=Ce(i,l);o&&r.push(l);const a=i.transaction(r,"readwrite");return await a.objectStore(w).put(t,n),o&&await a.objectStore(l).delete(n),await a.done,t}async function Oe(e){const t=R(e),n=await _();return Ne(n),await n.transaction(l).objectStore(l).get(t)}async function Lt(e,t){const n=R(e),i=await _();Ne(i);const r=i.transaction([w,l],"readwrite");return await r.objectStore(l).put(t,n),await r.objectStore(w).delete(n),await r.done,t}function R({appConfig:e}){return e.appId}const ee="@firebase/messaging",K="0.13.1";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ht=3,Bt=1e3;async function Vt(e,t){const n=await N(e),i=V(t,e.appConfig.appName,!1),r={method:"POST",headers:n,body:JSON.stringify(i)};let o;try{o=await(await fetch(C(e.appConfig),r)).json()}catch(a){throw u.create("token-subscribe-failed",{errorInfo:a==null?void 0:a.toString()})}if(o.error){const a=o.error.message;throw u.create("token-subscribe-failed",{errorInfo:a})}if(!o.token)throw u.create("token-subscribe-no-token");return o.token}async function Ut(e,t){var d;const n=await N(e),i=V(t,e.appConfig.appName,!0),r={method:"POST",headers:n,body:JSON.stringify(i)};let o;try{o=await Yt(()=>fetch(C(e.appConfig),r),Ht,Bt)}catch(s){throw u.create("fid-registration-failed",{errorInfo:s==null?void 0:s.toString()})}if(o.ok)return{responseFid:await Wt(o)};let a;try{a=await o.json()}catch{throw u.create("fid-registration-failed",{errorInfo:o.statusText})}const c=((d=a.error)==null?void 0:d.message)??o.statusText;throw u.create("fid-registration-failed",{errorInfo:c})}async function Wt(e){const t=await e.text();if(!t.trim())throw u.create("fid-registration-failed",{errorInfo:"CreateRegistration succeeded but response body is empty"});let n;try{n=JSON.parse(t)}catch{throw u.create("fid-registration-failed",{errorInfo:"CreateRegistration succeeded but response body is not valid JSON"})}const i=n.name;if(typeof i!="string"||i.length===0)throw u.create("fid-registration-failed",{errorInfo:"CreateRegistration succeeded but response did not include a non-empty name"});return Gt(i)}const te="/registrations/";function Gt(e){const t=e.indexOf(te);if(t!==-1){const n=e.slice(t+te.length);if(n.length>0)return n}throw u.create("fid-registration-failed",{errorInfo:"CreateRegistration succeeded but response name is not a valid registration resource name"})}async function Jt(e,t){const n=await N(e),i=V(t.subscriptionOptions,e.appConfig.appName,!1),r={method:"PATCH",headers:n,body:JSON.stringify(i)};let o;try{o=await(await fetch(`${C(e.appConfig)}/${t.token}`,r)).json()}catch(a){throw u.create("token-update-failed",{errorInfo:a==null?void 0:a.toString()})}if(o.error){const a=o.error.message;throw u.create("token-update-failed",{errorInfo:a})}if(!o.token)throw u.create("token-update-no-token");return o.token}async function zt(e,t){const i={method:"DELETE",headers:await N(e)};try{const o=await(await fetch(`${C(e.appConfig)}/${t}`,i)).json();if(o.error){const a=o.error.message;throw u.create("token-unsubscribe-failed",{errorInfo:a})}}catch(r){throw u.create("token-unsubscribe-failed",{errorInfo:r==null?void 0:r.toString()})}}async function Yt(e,t,n){let i;for(let r=0;r<t;r++)try{return await e()}catch(o){if(i=o,r<t-1){const a=n*Math.pow(2,r);await new Promise(c=>setTimeout(c,a))}}throw i}function C({projectId:e}){return`${Nt}/projects/${e}/registrations`}async function N({appConfig:e,installations:t}){const n=await t.getToken();return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e.apiKey,"x-goog-firebase-installations-auth":`FIS ${n}`})}function Qt(e,t){var n,i;try{if(/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(e))return new URL(e).host}catch{}try{if(typeof self<"u"&&((n=self.location)!=null&&n.href))return new URL(e,self.location.origin).host}catch{}return typeof self<"u"&&((i=self.location)!=null&&i.host)?self.location.host:t}function V({p256dh:e,auth:t,endpoint:n,vapidKey:i,swScope:r},o,a){const c={web:{origin:Qt(r,o),endpoint:n,auth:t,p256dh:e}};return a&&(c.fcm_sdk_version=K),i!==ve&&(c.web.applicationPubKey=i),c}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Xt=10080*60*1e3;async function Zt(e){const t=await tn(e.swRegistration,e.vapidKey),n={vapidKey:e.vapidKey,swScope:e.swRegistration.scope,endpoint:t.endpoint,auth:f(t.getKey("auth")),p256dh:f(t.getKey("p256dh"))},i=await qt(e.firebaseDependencies);if(i){if(nn(i.subscriptionOptions,n))return Date.now()>=i.createTime+Xt?en(e,{token:i.token,createTime:Date.now(),subscriptionOptions:n}):i.token;try{await zt(e.firebaseDependencies,i.token)}catch(r){console.warn(r)}return ne(e.firebaseDependencies,n)}else return ne(e.firebaseDependencies,n)}async function en(e,t){try{const n=await Jt(e.firebaseDependencies,t),i={...t,token:n,createTime:Date.now()};return await B(e.firebaseDependencies,i),n}catch(n){throw n}}async function ne(e,t){const i={token:await Vt(e,t),createTime:Date.now(),subscriptionOptions:t};return await B(e,i),i.token}async function tn(e,t){const n=await e.pushManager.getSubscription();return n||e.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:Re(t)})}function nn(e,t){const n=t.vapidKey===e.vapidKey,i=t.endpoint===e.endpoint,r=t.auth===e.auth,o=t.p256dh===e.p256dh;return n&&i&&r&&o}function rn(e,t){const n=e.onRegisteredHandler;n&&(typeof n=="function"?n(t):n.next(t))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function on(e){try{e.swRegistration=await navigator.serviceWorker.register(Rt,{scope:Ct}),e.swRegistration.update().catch(()=>{}),await an(e.swRegistration)}catch(t){throw u.create("failed-service-worker-registration",{browserErrorMessage:t==null?void 0:t.message})}}async function an(e){return new Promise((t,n)=>{const i=setTimeout(()=>n(new Error(`Service worker not registered after ${G} ms`)),G),r=e.installing||e.waiting;e.active?(clearTimeout(i),t()):r?r.onstatechange=o=>{var a;((a=o.target)==null?void 0:a.state)==="activated"&&(r.onstatechange=null,clearTimeout(i),t())}:(clearTimeout(i),n(new Error("No incoming service worker found.")))})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function De(e,t){if(!t&&!e.swRegistration&&await on(e),!(!t&&e.swRegistration)){if(!(t instanceof ServiceWorkerRegistration))throw u.create("invalid-sw-registration");e.swRegistration=t}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Fe(e,t){t?e.vapidKey=t:e.vapidKey||(e.vapidKey=ve)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ie=3;async function sn(e,t){const n=await cn(e.swRegistration,e.vapidKey),i={vapidKey:e.vapidKey,swScope:e.swRegistration.scope,endpoint:n.endpoint,auth:f(n.getKey("auth")),p256dh:f(n.getKey("p256dh"))},r=e.firebaseDependencies.installations;for(let o=0;o<ie;o++){const{responseFid:a}=await Ut(e.firebaseDependencies,i);if(a===t)return;o<ie-1&&await r.getToken(!0)}throw u.create("fid-registration-failed",{errorInfo:"CreateRegistration response FID does not match Firebase Installation ID"})}async function cn(e,t){const n=await e.pushManager.getSubscription();return n||e.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:Re(t)})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const un=10080*60*1e3;async function Me(e,t){if(!navigator)throw u.create("only-available-in-window");if(Notification.permission==="default"&&await Notification.requestPermission(),Notification.permission!=="granted")throw u.create("permission-blocked");if(!e.onRegisteredHandler)throw u.create("invalid-on-registered-handler");await Fe(e,t==null?void 0:t.vapidKey),await De(e,t==null?void 0:t.serviceWorkerRegistration);const n=e._registerNotifyChain.catch(()=>{});return e._registerNotifyChain=n.then(async()=>{const i=await e.firebaseDependencies.installations.getId(),r=await Oe(e.firebaseDependencies),o=Date.now();if((!r||r.fid!==i||o>=r.lastRegisterTime+un)&&(await sn(e,i),await Lt(e.firebaseDependencies,{fid:i,lastRegisterTime:o,vapidKey:e.vapidKey})),!e.onRegisteredHandler)throw u.create("invalid-on-registered-handler");rn(e,i)}),e._registerNotifyChain}/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function dn(e,t){return St(t,()=>{(async()=>!e.onRegisteredHandler||!await Oe(e.firebaseDependencies)||await Me(e).catch(()=>{}))()})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function re(e){const t={from:e.from,collapseKey:e.collapse_key,messageId:e.fcmMessageId};return fn(t,e),ln(t,e),pn(t,e),t}function fn(e,t){if(!t.notification)return;e.notification={};const n=t.notification.title;n&&(e.notification.title=n);const i=t.notification.body;i&&(e.notification.body=i);const r=t.notification.image;r&&(e.notification.image=r);const o=t.notification.icon;o&&(e.notification.icon=o)}function ln(e,t){t.data&&(e.data=t.data)}function pn(e,t){var r,o,a,c;if(!t.fcmOptions&&!((r=t.notification)!=null&&r.click_action))return;e.fcmOptions={};const n=((o=t.fcmOptions)==null?void 0:o.link)??((a=t.notification)==null?void 0:a.click_action);n&&(e.fcmOptions.link=n);const i=(c=t.fcmOptions)==null?void 0:c.analytics_label;i&&(e.fcmOptions.analyticsLabel=i)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function gn(e){return typeof e=="object"&&!!e&&_e in e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function hn(e){if(!e||!e.options)throw M("App Configuration Object");if(!e.name)throw M("App Name");const t=["projectId","apiKey","appId","messagingSenderId"],{options:n}=e;for(const i of t)if(!n[i])throw M(i);return{appName:e.name,projectId:n.projectId,apiKey:n.apiKey,appId:n.appId,senderId:n.messagingSenderId}}function M(e){return u.create("missing-app-config-values",{valueName:e})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class wn{constructor(t,n,i){this.deliveryMetricsExportedToBigQueryEnabled=!1,this.onBackgroundMessageHandler=null,this.onMessageHandler=null,this.onRegisteredHandler=null,this.onUnregisteredHandler=null,this._registerNotifyChain=Promise.resolve(),this._fidChangeUnsubscribe=null,this.logEvents=[],this.logQueue={state:"stopped"};const r=hn(t);this.firebaseDependencies={app:t,appConfig:r,installations:n,analyticsProvider:i}}_delete(){return this._fidChangeUnsubscribe&&(this._fidChangeUnsubscribe(),this._fidChangeUnsubscribe=null),this.logQueue.state==="scheduled"&&clearTimeout(this.logQueue.timerId),this.logQueue={state:"stopped"},Promise.resolve()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Pe(e,t){if(!navigator)throw u.create("only-available-in-window");if(Notification.permission==="default"&&await Notification.requestPermission(),Notification.permission!=="granted")throw u.create("permission-blocked");return await Fe(e,t==null?void 0:t.vapidKey),await De(e,t==null?void 0:t.serviceWorkerRegistration),Zt(e)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function bn(e,t,n){const i=yn(t);(await e.firebaseDependencies.analyticsProvider.get()).logEvent(i,{message_id:n[_e],message_name:n[Ot],message_time:n[Dt],message_device_time:Math.floor(Date.now()/1e3)})}function yn(e){switch(e){case y.NOTIFICATION_CLICKED:return"notification_open";case y.PUSH_RECEIVED:return"notification_foreground";default:throw new Error}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function mn(e,t){const n=t.data;if(!n.isFirebaseMessaging)return;if(e.onMessageHandler&&n.messageType===y.PUSH_RECEIVED&&(typeof e.onMessageHandler=="function"?e.onMessageHandler(re(n)):e.onMessageHandler.next(re(n))),e.onRegisteredHandler&&n.messageType===y.FID_REGISTERED){const r=n.fid;typeof e.onRegisteredHandler=="function"?e.onRegisteredHandler(r):e.onRegisteredHandler.next(r)}const i=n.data;gn(i)&&i[Ft]==="1"&&await bn(e,n.messageType,i)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Tn=e=>{const t=new wn(e.getProvider("app").getImmediate(),e.getProvider("installations-internal").getImmediate(),e.getProvider("analytics-internal"));return navigator.serviceWorker.addEventListener("message",n=>mn(t,n)),t._fidChangeUnsubscribe=dn(t,e.getProvider("installations").getImmediate()),t},In=e=>{const t=e.getProvider("messaging").getImmediate();return{getToken:i=>Pe(t,i),register:i=>Me(t,i)}};function Sn(){k(new A("messaging",Tn,"PUBLIC")),k(new A("messaging-internal",In,"PRIVATE")),S(ee,K),S(ee,K,"esm2020")}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function kn(){try{await je()}catch{return!1}return typeof window<"u"&&$e()&&qe()&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window&&"fetch"in window&&ServiceWorkerRegistration.prototype.hasOwnProperty("showNotification")&&PushSubscription.prototype.hasOwnProperty("getKey")}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function vn(e=Le()){return kn().then(t=>{if(!t)throw u.create("unsupported-browser")},t=>{throw u.create("indexed-db-unsupported")}),x(ae(e),"messaging").getImmediate()}async function _n(e,t){return e=ae(e),Pe(e,t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */Sn();export{vn as getMessaging,_n as getToken,kn as isSupported};
