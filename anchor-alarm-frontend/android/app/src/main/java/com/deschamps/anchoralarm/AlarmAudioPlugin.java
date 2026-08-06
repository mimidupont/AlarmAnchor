package com.deschamps.anchoralarm;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The alarm's actual noise.
 *
 * It used to be nothing but a notification channel with a sound on it.
 * A channel sound plays with USAGE_NOTIFICATION, and silent mode and
 * vibrate mode are defined as silencing exactly that — so the anchor alarm
 * was inaudible in the two states a phone is most likely to be in at
 * anchor overnight. The notification stays (it is what wakes the screen and
 * gives somewhere to tap), but the sound no longer comes from it.
 *
 * Playing on USAGE_ALARM is the whole point: the alarm stream is not
 * touched by the ringer being silenced, which is why alarm clocks still go
 * off on a phone set to silent. Do Not Disturb can still suppress it unless
 * alarms are allowed through, which is a device setting no app can override
 * and therefore belongs in the release notes.
 *
 * The vibration is a repeating waveform rather than a Haptics tick, and
 * carries the same USAGE_ALARM attributes so it survives DND on the same
 * terms as the sound.
 */
@CapacitorPlugin(name = "AlarmAudio")
public class AlarmAudioPlugin extends Plugin {

    private static final String TAG = "AlarmAudio";
    // On for 0.8s, off for 0.4s, repeating from index 0 — a pattern that
    // reads as an alarm rather than a notification.
    private static final long[] VIBRATE_PATTERN = { 0, 800, 400 };

    private MediaPlayer player;
    private Vibrator vibrator;

    @PluginMethod
    public void start(PluginCall call) {
        // Idempotent: an alarm re-fired while already sounding must not
        // stack a second MediaPlayer on top of the first.
        stopEverything();

        Context context = getContext();
        JSObject result = new JSObject();

        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );

            AssetFileDescriptor afd = context.getResources().openRawResourceFd(R.raw.alarm);
            try {
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            } finally {
                afd.close();
            }

            mp.setLooping(true);
            mp.prepare();
            mp.start();
            player = mp;
            result.put("playing", true);
        } catch (Exception e) {
            // Never let the noise failing take the alarm down: the
            // notification and the vibration are still worth having, and
            // the caller needs to know so it can say so.
            Log.e(TAG, "alarm audio failed to start", e);
            result.put("playing", false);
            result.put("error", String.valueOf(e.getMessage()));
        }

        try {
            startVibration(context);
            result.put("vibrating", true);
        } catch (Exception e) {
            Log.w(TAG, "alarm vibration failed to start", e);
            result.put("vibrating", false);
        }

        // Reported, not changed. An alarm stream turned down to zero makes
        // this alarm useless, but silently overriding a system volume the
        // user chose is not ours to do — surfacing it is.
        try {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                result.put("alarmVolume", am.getStreamVolume(AudioManager.STREAM_ALARM));
                result.put("alarmVolumeMax", am.getStreamMaxVolume(AudioManager.STREAM_ALARM));
                result.put("ringerMode", am.getRingerMode());
            }
        } catch (Exception e) {
            Log.w(TAG, "could not read alarm volume", e);
        }

        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopEverything();
        call.resolve();
    }

    /**
     * Whether the alarm stream is audible at all. Lets the app warn while
     * the boat is still safely at anchor, instead of at 3 a.m. when the
     * answer is discovered the hard way.
     */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("playing", player != null && player.isPlaying());
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                result.put("alarmVolume", am.getStreamVolume(AudioManager.STREAM_ALARM));
                result.put("alarmVolumeMax", am.getStreamMaxVolume(AudioManager.STREAM_ALARM));
                result.put("ringerMode", am.getRingerMode());
            }
        } catch (Exception e) {
            Log.w(TAG, "could not read alarm volume", e);
        }
        call.resolve(result);
    }

    private void startVibration(Context context) {
        Vibrator v = resolveVibrator(context);
        if (v == null || !v.hasVibrator()) return;
        vibrator = v;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            // repeat = 0: loop from the start of the pattern until cancelled.
            v.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, 0), attrs);
        } else {
            v.vibrate(VIBRATE_PATTERN, 0);
        }
    }

    private Vibrator resolveVibrator(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager =
                (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private void stopEverything() {
        if (player != null) {
            try {
                if (player.isPlaying()) player.stop();
            } catch (Exception e) {
                Log.w(TAG, "stopping alarm audio", e);
            }
            try {
                player.release();
            } catch (Exception e) {
                Log.w(TAG, "releasing alarm audio", e);
            }
            player = null;
        }
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception e) {
                Log.w(TAG, "cancelling vibration", e);
            }
            vibrator = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopEverything();
        super.handleOnDestroy();
    }
}
