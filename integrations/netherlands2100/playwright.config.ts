import {defineConfig} from '@playwright/test';
const port=Number(process.env.TEST_PORT||5183);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid TEST_PORT');
export default defineConfig({
 testDir:'tests/browser',workers:1,timeout:90000,expect:{timeout:25000},
 reporter:[['list'],['json',{outputFile:process.env.PW_REPORT_FILE||'docs/mission03-playwright-results.json'}]],
 use:{baseURL:process.env.TEST_BASE_URL||`http://127.0.0.1:${port}`,viewport:{width:1920,height:1080},headless:true,
  launchOptions:{...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']},screenshot:'only-on-failure'},
 webServer:process.env.TEST_BASE_URL?undefined:{command:`python3 -m http.server ${port} --bind 127.0.0.1 --directory ../..`,url:`http://127.0.0.1:${port}/climate/`,reuseExistingServer:true,timeout:30000}
});
