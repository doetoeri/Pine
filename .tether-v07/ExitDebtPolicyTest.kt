package com.tether.focus

import org.junit.Assert.assertEquals
import org.junit.Test

class ExitDebtPolicyTest {
    @Test
    fun nonStrictHasNoGate() {
        assertEquals(0, ExitDebtPolicy.gateSeconds(false, 10, 0))
    }

    @Test
    fun violationsIncreaseGateButCapAtThirty() {
        assertEquals(10, ExitDebtPolicy.gateSeconds(true, 0, 0))
        assertEquals(15, ExitDebtPolicy.gateSeconds(true, 2, 1))
        assertEquals(30, ExitDebtPolicy.gateSeconds(true, 99, 0))
    }

    @Test
    fun allowedExitsReduceViolationCount() {
        assertEquals(0, ExitDebtPolicy.violationCount(2, 2))
        assertEquals(2, ExitDebtPolicy.violationCount(4, 2))
    }
}
