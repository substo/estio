package com.estio.simrelay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.net.Uri
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.estio.simrelay.api.ApiClient
import com.google.android.material.button.MaterialButton
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvServerUrl: TextView
    private lateinit var ivStatusIcon: ImageView
    
    private lateinit var layoutPairing: LinearLayout
    private lateinit var etPairingCode: EditText
    private lateinit var btnPair: MaterialButton
    private lateinit var btnScanQr: MaterialButton
    
    private lateinit var layoutService: LinearLayout
    private lateinit var btnToggleService: MaterialButton
    private lateinit var btnUnpair: MaterialButton

    private val PERMISSIONS = arrayOf(
        Manifest.permission.SEND_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.READ_PHONE_NUMBERS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.POST_NOTIFICATIONS,
        Manifest.permission.CAMERA
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        tvServerUrl = findViewById(R.id.tvServerUrl)
        ivStatusIcon = findViewById(R.id.ivStatusIcon)
        
        layoutPairing = findViewById(R.id.layoutPairing)
        etPairingCode = findViewById(R.id.etPairingCode)
        btnPair = findViewById(R.id.btnPair)
        btnScanQr = findViewById(R.id.btnScanQr)
        
        layoutService = findViewById(R.id.layoutService)
        btnToggleService = findViewById(R.id.btnToggleService)
        btnUnpair = findViewById(R.id.btnUnpair)

        checkPermissions()
        updateUI()

        btnPair.setOnClickListener {
            val code = etPairingCode.text.toString().trim()
            if (code.isNotEmpty()) {
                pairDevice(code, "https://estio.co") // Fallback
            } else {
                Toast.makeText(this, "Enter pairing code", Toast.LENGTH_SHORT).show()
            }
        }

        btnScanQr.setOnClickListener {
            scanQrCode()
        }

        btnToggleService.setOnClickListener {
            if (RelayForegroundService.isRunning && TunnelForegroundService.isRunning) {
                stopService(Intent(this, RelayForegroundService::class.java))
                stopService(Intent(this, TunnelForegroundService::class.java))
                Toast.makeText(this, "Service Stopped", Toast.LENGTH_SHORT).show()
            } else {
                val intent = Intent(this, RelayForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent)
                    startForegroundService(Intent(this, TunnelForegroundService::class.java))
                } else {
                    startService(intent)
                    startService(Intent(this, TunnelForegroundService::class.java))
                }
                Toast.makeText(this, "Service Started", Toast.LENGTH_SHORT).show()
            }
            // Small delay to allow service to start/stop before updating UI
            btnToggleService.postDelayed({ updateUI() }, 300)
        }

        btnUnpair.setOnClickListener {
            stopService(Intent(this, RelayForegroundService::class.java))
            stopService(Intent(this, TunnelForegroundService::class.java))
            val prefs = SecurePrefs.get(this)
            prefs.edit().clear().apply()
            updateUI()
            Toast.makeText(this, "Device Unpaired", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        if (RelayForegroundService.isRunning && !TunnelForegroundService.isRunning) {
            val tunnelIntent = Intent(this, TunnelForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(tunnelIntent)
            else startService(tunnelIntent)
        }
        updateUI()
        btnToggleService.postDelayed({ updateUI() }, 500)
    }

    private fun checkPermissions() {
        val missing = PERMISSIONS.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 101)
        }
    }

    private fun scanQrCode() {
        val scanner = GmsBarcodeScanning.getClient(this)
        scanner.startScan()
            .addOnSuccessListener { barcode ->
                val rawValue = barcode.rawValue
                if (rawValue != null) {
                    try {
                        val json = JSONObject(rawValue)
                        val pairCode = json.getString("pairCode")
                        val baseUrl = json.optString("baseUrl", "https://estio.co")
                        if (!isAllowedBaseUrl(baseUrl)) {
                            Toast.makeText(this, "QR code uses an untrusted Estio server", Toast.LENGTH_LONG).show()
                            return@addOnSuccessListener
                        }
                        etPairingCode.setText(pairCode)
                        pairDevice(pairCode, baseUrl)
                    } catch (e: Exception) {
                        Toast.makeText(this, "Invalid QR Code format", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .addOnFailureListener { e ->
                Toast.makeText(this, "Scanning failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
    }

    private fun updateUI() {
        val prefs = SecurePrefs.get(this)
        val token = prefs.getString("device_token", null)
        val baseUrl = prefs.getString("base_url", "https://estio.co")
        
        if (token != null) {
            layoutPairing.visibility = View.GONE
            layoutService.visibility = View.VISIBLE
            tvServerUrl.text = "Connected to $baseUrl"
            
            if (RelayForegroundService.isRunning && TunnelForegroundService.isRunning && TunnelForegroundService.isConnected) {
                tvStatus.text = "Service Running"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#10B981")) // Green
                ivStatusIcon.setImageResource(android.R.drawable.ic_dialog_email)
                ivStatusIcon.setColorFilter(android.graphics.Color.parseColor("#10B981"))
                btnToggleService.text = "Stop Relay Service"
                btnToggleService.setBackgroundColor(android.graphics.Color.parseColor("#EF4444"))
            } else if (RelayForegroundService.isRunning || TunnelForegroundService.isRunning) {
                tvStatus.text = "Service Recovering"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
                ivStatusIcon.setImageResource(android.R.drawable.stat_notify_sync)
                ivStatusIcon.setColorFilter(android.graphics.Color.parseColor("#F59E0B"))
                btnToggleService.text = if (RelayForegroundService.isRunning && TunnelForegroundService.isRunning) {
                    "Stop Relay Service"
                } else {
                    "Resume Relay Service"
                }
                btnToggleService.setBackgroundColor(android.graphics.Color.parseColor(
                    if (RelayForegroundService.isRunning && TunnelForegroundService.isRunning) "#EF4444" else "#10B981"
                ))
            } else {
                tvStatus.text = "Service Stopped"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#0F172A"))
                ivStatusIcon.setImageResource(android.R.drawable.presence_offline)
                ivStatusIcon.setColorFilter(android.graphics.Color.parseColor("#64748B"))
                btnToggleService.text = "Start Relay Service"
                btnToggleService.setBackgroundColor(android.graphics.Color.parseColor("#10B981"))
            }
        } else {
            layoutPairing.visibility = View.VISIBLE
            layoutService.visibility = View.GONE
            tvStatus.text = "Not Paired"
            tvStatus.setTextColor(android.graphics.Color.parseColor("#0F172A"))
            tvServerUrl.text = "Scan QR code from the CRM to connect"
            ivStatusIcon.setImageResource(android.R.drawable.presence_offline)
            ivStatusIcon.setColorFilter(android.graphics.Color.parseColor("#64748B"))
        }
    }

    private fun pairDevice(code: String, baseUrl: String) {
        if (!isAllowedBaseUrl(baseUrl)) {
            Toast.makeText(this, "Untrusted Estio server URL", Toast.LENGTH_LONG).show()
            return
        }
        btnPair.isEnabled = false
        btnScanQr.isEnabled = false
        
        // Initialize client with correct URL
        ApiClient.initBaseUrl(baseUrl)
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val req = com.estio.simrelay.api.PairRequest(
                    pair_code = code,
                    phone_number = SimPhoneNumberDetector.detect(this@MainActivity),
                    tunnel_public_key = DeviceKeyManager.publicKeyBase64(),
                    app_version = BuildConfig.VERSION_NAME,
                    capabilities = listOf("sms_relay", "whatsapp_egress")
                )
                val response = ApiClient.api.pairDevice(req)
                withContext(Dispatchers.Main) {
                    if (response.isSuccessful && response.body() != null) {
                        val token = response.body()!!.device_api_token
                        val prefs = SecurePrefs.get(this@MainActivity)
                        prefs.edit()
                            .putString("device_token", token)
                            .putString("base_url", baseUrl)
                            .apply()
                            
                        ApiClient.initToken(token)
                        Toast.makeText(this@MainActivity, "Paired Successfully!", Toast.LENGTH_LONG).show()
                        
                        // Auto-start service
                        val intent = Intent(this@MainActivity, RelayForegroundService::class.java)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(intent)
                            startForegroundService(Intent(this@MainActivity, TunnelForegroundService::class.java))
                        } else {
                            startService(intent)
                            startService(Intent(this@MainActivity, TunnelForegroundService::class.java))
                        }
                        updateUI()
                    } else {
                        Toast.makeText(this@MainActivity, "Pairing Failed", Toast.LENGTH_LONG).show()
                    }
                    btnPair.isEnabled = true
                    btnScanQr.isEnabled = true
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                    btnPair.isEnabled = true
                    btnScanQr.isEnabled = true
                }
            }
        }
    }

    private fun isAllowedBaseUrl(value: String): Boolean {
        return try {
            val uri = Uri.parse(value)
            val host = uri.host?.lowercase() ?: return false
            uri.scheme == "https" && (host == "estio.co" || host.endsWith(".estio.co")) && uri.userInfo == null
        } catch (_: Exception) {
            false
        }
    }
}
