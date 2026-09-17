package com.tether.focus

import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

object UsageAccessGuard {
    fun hasAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun requestAccess(context: Context) {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    fun latestExternalPackageSince(context: Context, sinceEpochMs: Long, untilEpochMs: Long = System.currentTimeMillis()): String? {
        if (!hasAccess(context) || sinceEpochMs <= 0L) return null
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = runCatching { manager.queryEvents(sinceEpochMs, untilEpochMs) }.getOrNull() ?: return null
        val event = UsageEvents.Event()
        var latestPackage: String? = null
        var latestTime = Long.MIN_VALUE
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val foreground = event.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
                event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
            if (foreground && event.timeStamp >= latestTime) {
                val pkg = event.packageName
                if (!pkg.isNullOrBlank() && pkg != context.packageName) {
                    latestPackage = pkg
                    latestTime = event.timeStamp
                }
            }
        }
        return latestPackage
    }
}

object FocusShield {
    private const val PREFS = "tether_focus_shield"
    private const val KEY_ENGAGED = "engaged"
    private const val KEY_PREVIOUS_FILTER = "previous_filter"

    fun hasAccess(context: Context): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return nm.isNotificationPolicyAccessGranted
    }

    fun requestAccess(context: Context) {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    fun enable(context: Context): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.isNotificationPolicyAccessGranted) return false
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_ENGAGED, false)) {
            prefs.edit()
                .putInt(KEY_PREVIOUS_FILTER, nm.currentInterruptionFilter)
                .putBoolean(KEY_ENGAGED, true)
                .apply()
        }
        return runCatching {
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
            true
        }.getOrDefault(false)
    }

    fun disable(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_ENGAGED, false)) return
        val previous = prefs.getInt(KEY_PREVIOUS_FILTER, NotificationManager.INTERRUPTION_FILTER_ALL)
        if (nm.isNotificationPolicyAccessGranted) {
            runCatching { nm.setInterruptionFilter(previous) }
        }
        prefs.edit().clear().apply()
    }

    fun isEngaged(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENGAGED, false)
}

object ExitDebtPolicy {
    fun gateSeconds(strictMode: Boolean, exitCount: Int, allowedExits: Int): Int {
        if (!strictMode) return 0
        val violations = (exitCount - allowedExits).coerceAtLeast(0)
        return (10 + violations * 5).coerceAtMost(30)
    }

    fun violationCount(exitCount: Int, allowedExits: Int): Int =
        (exitCount - allowedExits).coerceAtLeast(0)
}
