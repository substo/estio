package com.estio.simrelay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.estio.simrelay.api.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var etPairingCode: EditText
    private lateinit var btnPair: Button
    private lateinit var btnStartService: Button

    private val PERMISSIONS = arrayOf(
        Manifest.permission.SEND_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.POST_NOTIFICATIONS
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        etPairingCode = findViewById(R.id.etPairingCode)
        btnPair = findViewById(R.id.btnPair)
        btnStartService = findViewById(R.id.btnStartService)

        checkPermissions()
        updateUI()

        btnPair.setOnClickListener {
            val code = etPairingCode.text.toString().trim()
            if (code.isNotEmpty()) {
                pairDevice(code)
            } else {
                Toast.makeText(this, "Enter pairing code", Toast.LENGTH_SHORT).show()
            }
        }

        btnStartService.setOnClickListener {
            val intent = Intent(this, RelayForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            Toast.makeText(this, "Service Started", Toast.LENGTH_SHORT).show()
        }
    }

    private fun checkPermissions() {
        val missing = PERMISSIONS.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 101)
        }
    }

    private fun updateUI() {
        val prefs = getSharedPreferences("estio_prefs", Context.MODE_PRIVATE)
        val token = prefs.getString("device_token", null)
        if (token != null) {
            tvStatus.text = "Status: Paired & Ready"
            btnStartService.isEnabled = true
        } else {
            tvStatus.text = "Status: Unpaired"
            btnStartService.isEnabled = false
        }
    }

    private fun pairDevice(code: String) {
        btnPair.isEnabled = false
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // We assume there's an api instance.
                // Replace with actual production domain when building APK
                val req = com.estio.simrelay.api.PairRequest(code)
                val response = ApiClient.api.pairDevice(req)
                withContext(Dispatchers.Main) {
                    if (response.isSuccessful && response.body() != null) {
                        val token = response.body()!!.device_api_token
                        val prefs = getSharedPreferences("estio_prefs", Context.MODE_PRIVATE)
                        prefs.edit().putString("device_token", token).apply()
                        ApiClient.initToken(token)
                        Toast.makeText(this@MainActivity, "Paired Successfully!", Toast.LENGTH_LONG).show()
                        updateUI()
                    } else {
                        Toast.makeText(this@MainActivity, "Pairing Failed", Toast.LENGTH_LONG).show()
                    }
                    btnPair.isEnabled = true
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                    btnPair.isEnabled = true
                }
            }
        }
    }
}
