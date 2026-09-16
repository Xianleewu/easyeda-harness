export function evaluateInstall({nodeMajor,dependenciesOk,skillPath='',bridge=null,offline=false}={}){
	const checks=[
		{id:'node',pass:Number(nodeMajor)>=20,detail:`Node ${nodeMajor ?? 'unknown'} (requires >=20)`},
		{id:'dependencies',pass:dependenciesOk===true,detail:dependenciesOk===true?'npm dependencies resolve':'run npm ci'},
	];
	if(!offline){
		checks.push({id:'api-skill',pass:Boolean(skillPath),detail:skillPath||'set EASYEDA_API_SKILL_DIR or install easyeda-api-skill'});
		checks.push({id:'bridge',pass:bridge?.service==='easyeda-bridge',detail:bridge?.service==='easyeda-bridge'?`port ${bridge.port}`:'bridge not found on ports 49620-49629'});
		checks.push({id:'eda',pass:bridge?.edaConnected===true&&Number(bridge?.edaWindowCount)>0,
			detail:bridge?.edaConnected===true?`${bridge.edaWindowCount} EasyEDA window(s) connected`:'load the API Gateway extension in EasyEDA'});
	}
	return{pass:checks.every(check=>check.pass),checks};
}
