package com.tether.focus

import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm by viewModels<TetherViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TetherApp(vm)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        vm.onForeground()
    }

    override fun onStop() {
        vm.onBackground()
        super.onStop()
    }
}

@Composable
private fun TetherApp(vm: TetherViewModel) {
    val context = LocalContext.current
    val vault = remember { ApiKeyVault(context.applicationContext) }
    val scope = rememberCoroutineScope()

    var apiKey by remember { mutableStateOf(vault.load()) }
    var keySaved by remember { mutableStateOf(apiKey.isNotBlank()) }
    var aiPlan by remember { mutableStateOf<AtomicPlan?>(null) }
    var aiBusy by remember { mutableStateOf(false) }
    var aiStatus by remember { mutableStateOf("") }
    var rescueBusy by remember { mutableStateOf(false) }
    var rescueStep by remember { mutableStateOf("") }

    val requestRescue: (String) -> Unit = { currentAction ->
        if (currentAction.isNotBlank() && !rescueBusy) {
            rescueBusy = true
            rescueStep = ""
            if (apiKey.isBlank()) {
                rescueStep = AtomicPlanner.shrink(currentAction)
                aiStatus = "API 키 없음 · 로컬 구조 행동 사용"
                rescueBusy = false
            } else {
                scope.launch {
                    val result = GeminiTaskPlanner.createRescueStep(
                        apiKey = apiKey,
                        model = GeminiTaskPlanner.DEFAULT_MODEL,
                        currentAction = currentAction
                    )
                    rescueStep = result.getOrElse { AtomicPlanner.shrink(currentAction) }
                    aiStatus = result.fold(
                        onSuccess = { "AI가 30~90초 구조 행동을 만들었음" },
                        onFailure = { "AI 실패 · 로컬 구조 행동으로 대체" }
                    )
                    rescueBusy = false
                }
            }
        }
    }

    LaunchedEffect(vm.screen) {
        while (vm.screen == AppScreen.FOCUS) {
            vm.tick()
            delay(250)
        }
    }

    when (vm.screen) {
        AppScreen.SETUP -> SetupScreen(
            vm = vm,
            apiKey = apiKey,
            keySaved = keySaved,
            aiPlan = aiPlan,
            aiBusy = aiBusy,
            aiStatus = aiStatus,
            onApiKeyChange = {
                apiKey = it
                keySaved = false
            },
            onSaveKey = {
                vault.save(apiKey)
                keySaved = apiKey.isNotBlank()
                aiStatus = if (keySaved) "API 키를 Android Keystore로 암호화 저장함" else "API 키가 비어 있음"
            },
            onDeleteKey = {
                vault.clear()
                apiKey = ""
                keySaved = false
                aiStatus = "API 키 삭제됨 · 로컬 분해 사용"
            },
            onGenerate = {
                val goal = vm.draft.trim()
                if (goal.isNotEmpty() && !aiBusy) {
                    aiBusy = true
                    aiPlan = null
                    if (apiKey.isBlank()) {
                        aiPlan = AtomicPlanner.plan(goal)
                        aiStatus = "API 키 없음 · 로컬 분해 결과"
                        aiBusy = false
                    } else {
                        val attention = vm.previewPlan()
                        scope.launch {
                            val result = GeminiTaskPlanner.createPlan(
                                apiKey = apiKey,
                                model = GeminiTaskPlanner.DEFAULT_MODEL,
                                goal = goal,
                                riskBand = attention.band,
                                predictedFirstDriftMinute = attention.predictedFirstDriftMinute
                            )
                            aiPlan = result.getOrElse { AtomicPlanner.plan(goal) }
                            aiStatus = result.fold(
                                onSuccess = { "Gemini가 ${it.actions.size}개 행동으로 분해함" },
                                onFailure = { "AI 호출 실패 · 로컬 분해로 자동 대체" }
                            )
                            aiBusy = false
                        }
                    }
                }
            },
            onAddPlan = {
                aiPlan?.let { plan ->
                    vm.addAiPlan(plan)
                    aiStatus = "${plan.actions.size}개 행동을 실행 큐에 추가함"
                    aiPlan = null
                }
            }
        )

        AppScreen.FOCUS -> FocusScreen(
            vm = vm,
            rescueBusy = rescueBusy,
            rescueStep = rescueStep,
            onRescue = { requestRescue(vm.currentTask) },
            onClearRescue = { rescueStep = "" }
        )

        AppScreen.RECOVERY -> RecoveryScreen(
            vm = vm,
            rescueBusy = rescueBusy,
            rescueStep = rescueStep,
            onRescue = { requestRescue(vm.currentTask) },
            onClearRescue = { rescueStep = "" }
        )

        AppScreen.REPORT -> ReportScreen(vm)
    }
}

@Composable
private fun SetupScreen(
    vm: TetherViewModel,
    apiKey: String,
    keySaved: Boolean,
    aiPlan: AtomicPlan?,
    aiBusy: Boolean,
    aiStatus: String,
    onApiKeyChange: (String) -> Unit,
    onSaveKey: () -> Unit,
    onDeleteKey: () -> Unit,
    onGenerate: () -> Unit,
    onAddPlan: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Tether", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("큰 계획을 쓰지 말고, 오늘 실제로 끝내야 하는 것을 적는다.")

        OutlinedTextField(
            value = vm.draft,
            onValueChange = vm::updateDraft,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("예: 경우의 수 문제집 12쪽 끝내기") },
            minLines = 2
        )

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("AI Task Compiler", fontWeight = FontWeight.Bold)
                Text("Gemini 3.1 Flash-Lite · 실패하면 로컬 분해기로 즉시 대체")
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = onApiKeyChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Gemini API Key") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onSaveKey) { Text(if (keySaved) "저장됨" else "키 저장") }
                    TextButton(onClick = onDeleteKey) { Text("삭제") }
                }
                Button(
                    onClick = onGenerate,
                    enabled = vm.draft.isNotBlank() && !aiBusy,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (aiBusy) CircularProgressIndicator(modifier = Modifier.height(20.dp))
                    else Text("AI로 실제 행동 쪼개기")
                }
                if (aiStatus.isNotBlank()) Text(aiStatus, style = MaterialTheme.typography.bodySmall)
            }
        }

        aiPlan?.let { plan ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("실행안 · 약 ${plan.estimatedTotalMinutes}분", fontWeight = FontWeight.Bold)
                    plan.actions.forEachIndexed { index, action ->
                        Text("${index + 1}. ${action.action} · ${action.estimatedMinutes}분")
                    }
                    Button(onClick = onAddPlan, modifier = Modifier.fillMaxWidth()) {
                        Text("이 행동들로 시작")
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("오프라인 앵커 체크", modifier = Modifier.weight(1f))
            Switch(checked = vm.anchorEnabled, onCheckedChange = vm::updateAnchorEnabled)
        }

        if (vm.queue.isNotEmpty()) {
            HorizontalDivider()
            Text("실행 큐", fontWeight = FontWeight.Bold)
            vm.queue.forEachIndexed { index, unit ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(unit.action)
                            Text("약 ${unit.estimatedMinutes}분", style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton(onClick = { vm.removeQueueItem(index) }) { Text("삭제") }
                    }
                }
            }
            Button(onClick = vm::start, modifier = Modifier.fillMaxWidth()) {
                Text("첫 행동 시작")
            }
        } else if (vm.draft.isNotBlank()) {
            OutlinedButton(onClick = vm::addDraftAsAtomicPlan, modifier = Modifier.fillMaxWidth()) {
                Text("AI 없이 로컬 분해")
            }
        }
    }
}

@Composable
private fun FocusScreen(
    vm: TetherViewModel,
    rescueBusy: Boolean,
    rescueStep: String,
    onRescue: () -> Unit,
    onClearRescue: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text("지금 이것만", style = MaterialTheme.typography.labelLarge)
        Text(vm.currentTask, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(formatClock(vm.remainingMs), style = MaterialTheme.typography.displayMedium)
        Text("이탈 ${vm.exitCount} · 충동 ${vm.urgeCount} · 복귀 ${vm.recoveryCount}")

        if (rescueBusy) {
            CircularProgressIndicator()
            Text("더 작은 시작점을 만드는 중…")
        }
        if (rescueStep.isNotBlank()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("구조 행동", fontWeight = FontWeight.Bold)
                    Text(rescueStep)
                    Button(onClick = onClearRescue) { Text("이것부터 한다") }
                }
            }
        }

        Spacer(modifier = Modifier.weight(1f))
        Button(onClick = vm::logUrge, modifier = Modifier.fillMaxWidth()) { Text("딴짓하고 싶음") }
        OutlinedButton(onClick = onRescue, modifier = Modifier.fillMaxWidth(), enabled = !rescueBusy) {
            Text("막힘 · 더 작은 행동 만들기")
        }
        if (vm.anchorEnabled && vm.anchorGraceUntil > SystemClock.elapsedRealtime()) {
            OutlinedButton(onClick = vm::acknowledgeAnchor, modifier = Modifier.fillMaxWidth()) {
                Text("앵커 확인 · 아직 여기 있음")
            }
        }
        TextButton(onClick = vm::finish, modifier = Modifier.fillMaxWidth()) { Text("세션 종료") }
    }
}

@Composable
private fun RecoveryScreen(
    vm: TetherViewModel,
    rescueBusy: Boolean,
    rescueStep: String,
    onRescue: () -> Unit,
    onClearRescue: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text("복귀", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(vm.recoveryMessage)
        Text("원래 행동", fontWeight = FontWeight.Bold)
        Text(vm.currentTask)

        if (rescueBusy) CircularProgressIndicator()
        if (rescueStep.isNotBlank()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("다시 시작할 최소 행동", fontWeight = FontWeight.Bold)
                    Text(rescueStep)
                    Button(onClick = {
                        onClearRescue()
                        vm.resumeWithMicroStep()
                    }) { Text("이것부터 복귀") }
                }
            }
        }

        Button(onClick = vm::resumeNormally, modifier = Modifier.fillMaxWidth()) { Text("원래 행동으로 복귀") }
        OutlinedButton(onClick = onRescue, modifier = Modifier.fillMaxWidth(), enabled = !rescueBusy) {
            Text("너무 큼 · AI/로컬로 더 작게")
        }
        TextButton(onClick = vm::resumeWithMicroStep, modifier = Modifier.fillMaxWidth()) {
            Text(vm.microStep())
        }
    }
}

@Composable
private fun ReportScreen(vm: TetherViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("세션 리포트", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(vm.currentTask)
        Text("앱 이탈 ${vm.exitCount}회")
        Text("앱 밖 ${formatDuration(vm.awayMs)}")
        Text("충동 ${vm.urgeCount}회")
        Text("첫 흔들림 ${vm.firstDriftLabel()}")
        Text("평균 복귀 지연 ${formatDuration(vm.averageRecoveryLatencyMs())}")
        Spacer(modifier = Modifier.weight(1f))
        Button(onClick = { vm.completeReport(true) }, modifier = Modifier.fillMaxWidth()) { Text("이 행동 완료") }
        OutlinedButton(onClick = { vm.completeReport(false) }, modifier = Modifier.fillMaxWidth()) { Text("미완료 · 큐에 남기기") }
    }
}
