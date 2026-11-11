import {NextResponse} from 'next/server';
import {authorizeAutomationRunner,automationRunnerStatus,runAutomationBatch} from '@/lib/automation';
import {automationHeaders as headers} from '@/lib/automation-route';
export const runtime='nodejs';
// Safe static runner messages are retained; only public category codes are added.
// No cookie auth, GET execution, generic CRON_SECRET fallback, URL token or external setup.
export async function POST(request:Request){const status=automationRunnerStatus();if(!status.enabled||!status.configured)return NextResponse.json({error:'Automation runner is disabled or unconfigured',code:'UNAVAILABLE'},{status:503,headers});if(!authorizeAutomationRunner(request.headers.get('authorization')))return NextResponse.json({error:'Runner authorization required',code:'UNAUTHENTICATED'},{status:401,headers});if(request.headers.has('origin')||request.headers.get('sec-fetch-site'))return NextResponse.json({error:'Server runner only',code:'FORBIDDEN'},{status:403,headers});try{return NextResponse.json(await runAutomationBatch(),{headers});}catch{return NextResponse.json({error:'Runner unavailable; durable work remains pending',code:'UNAVAILABLE'},{status:503,headers});}}
