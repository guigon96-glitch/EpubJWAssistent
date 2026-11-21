package com.criadordeepub.leitor

import android.accounts.Account
import android.app.Activity
import android.content.Context
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.tasks.await

/** Conta conectada (guardada só neste aparelho). */
object Prefs {
    private fun p(c: Context) = c.getSharedPreferences("leitor", Context.MODE_PRIVATE)

    fun email(c: Context): String? = p(c).getString("email", null)
    fun name(c: Context): String? = p(c).getString("nome", null)
    fun setAccount(c: Context, email: String?, name: String?) =
        p(c).edit().putString("email", email).putString("nome", name).apply()

    fun textZoom(c: Context) = p(c).getInt("zoom", 160)
    fun setTextZoom(c: Context, v: Int) = p(c).edit().putInt("zoom", v).apply()
    /** Brilho só do leitor: -1 = automático (o do sistema), ou 0.02 a 1.0. */
    fun brightness(c: Context) = p(c).getFloat("brilho", -1f)
    fun setBrightness(c: Context, v: Float) = p(c).edit().putFloat("brilho", v).apply()
    fun theme(c: Context) = p(c).getString("tema", "light")!!
    fun setTheme(c: Context, v: String) = p(c).edit().putString("tema", v).apply()

    fun position(c: Context, key: String): Pair<Int, Double>? =
        p(c).getString("pos_$key", null)?.split('|')?.let { parts ->
            val i = parts.getOrNull(0)?.toIntOrNull() ?: return null
            i to (parts.getOrNull(1)?.toDoubleOrNull() ?: 0.0)
        }
    fun setPosition(c: Context, key: String, index: Int, frac: Double) =
        p(c).edit().putString("pos_$key", "$index|$frac").apply()
    fun clearPositions(c: Context, prefix: String) {
        val e = p(c).edit()
        p(c).all.keys.filter { it.startsWith("pos_$prefix") }.forEach { e.remove(it) }
        e.apply()
    }
}

class NeedsUserException : Exception("É preciso entrar com a conta Google")

/**
 * Login com Google usando a API de autorização atual (Identity.getAuthorizationClient).
 * Escopos: drive.file (somente arquivos criados pelo app) + openid/email/profile para saber
 * qual conta foi escolhida (documentação oficial: "Get user information during authorization").
 */
class GoogleAuth(private val activity: Activity, private val launcher: ActivityResultLauncher<IntentSenderRequest>) {

    companion object {
        const val DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
        val SCOPES = listOf(Scope(DRIVE_FILE), Scope("openid"), Scope("email"), Scope("profile"))
    }

    private val client get() = Identity.getAuthorizationClient(activity)
    private var pending: CompletableDeferred<AuthorizationResult>? = null

    /** Chamar a partir do callback do [launcher]. */
    fun onLauncherResult(data: android.content.Intent?) {
        val p = pending ?: return
        pending = null
        try {
            p.complete(client.getAuthorizationResultFromIntent(data))
        } catch (e: Exception) {
            p.completeExceptionally(e)
        }
    }

    /**
     * Obtém um token de acesso. Se [interactive] for falso e o Google precisar mostrar a tela
     * de escolha de conta/permissão, lança [NeedsUserException].
     */
    suspend fun accessToken(email: String?, interactive: Boolean): String {
        val builder = AuthorizationRequest.builder().setRequestedScopes(SCOPES)
        if (email != null) builder.setAccount(Account(email, "com.google"))
        var result = client.authorize(builder.build()).await()
        if (result.hasResolution()) {
            if (!interactive) throw NeedsUserException()
            val d = CompletableDeferred<AuthorizationResult>()
            pending = d
            launcher.launch(IntentSenderRequest.Builder(result.pendingIntent!!.intentSender).build())
            result = d.await()
        }
        val granted: List<String> = result.grantedScopes
        if (DRIVE_FILE !in granted) throw SecurityException("A permissão de acesso ao Google Drive não foi concedida.")
        return result.accessToken ?: throw IllegalStateException("O Google não devolveu um token de acesso.")
    }

    suspend fun clearToken(token: String) {
        runCatching { client.clearToken(ClearTokenRequest.builder().setToken(token).build()).await() }
    }

    /** Sai da conta: limpa a conta padrão do app, para o seletor de contas aparecer de novo. */
    suspend fun signOut(lastToken: String?) {
        if (lastToken != null) clearToken(lastToken)
        runCatching { CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
