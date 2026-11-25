package kz.hiker.app;

import android.Manifest;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.telephony.SmsManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Нативный плагин «Горный хайкер»:
 *  - sendSms   : отправка SMS напрямую из приложения (без открытия приложения «Сообщения»)
 *  - listContacts : список контактов устройства для выбора получателя уведомления
 */
@CapacitorPlugin(
    name = "HikerNative",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
    }
)
public class HikerNative extends Plugin {

    private static final int MAX_CONTACTS = 500;

    /** Отправить SMS. Аргументы: { to: string, message: string } */
    @PluginMethod
    public void sendSms(PluginCall call) {
        String to = call.getString("to");
        String message = call.getString("message");
        if (to == null || to.trim().isEmpty() || message == null || message.isEmpty()) {
            call.reject("Нужны поля to и message");
            return;
        }
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        doSendSms(call, to.trim(), message);
    }

    @PermissionCallback
    public void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            doSendSms(call, call.getString("to"), call.getString("message"));
        } else {
            call.reject("Нет разрешения на отправку SMS");
        }
    }

    private void doSendSms(PluginCall call, String to, String message) {
        try {
            SmsManager sms = SmsManager.getDefault();
            if (sms == null) {
                call.reject("SMS-сервис недоступен на этом устройстве");
                return;
            }
            sms.sendTextMessage(to, null, message, null, null);
            JSObject res = new JSObject();
            res.put("sent", true);
            res.put("to", to);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Ошибка отправки SMS: " + e.getMessage());
        }
    }

    /** Список контактов устройства. Возвращает { contacts: [{name, phone}] } */
    @PluginMethod
    public void listContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
            return;
        }
        doListContacts(call);
    }

    @PermissionCallback
    public void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            doListContacts(call);
        } else {
            call.reject("Нет разрешения на чтение контактов");
        }
    }

    private void doListContacts(PluginCall call) {
        JSArray out = new JSArray();
        Uri uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                uri, projection, null, null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC"
            );
            if (cursor != null) {
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int n = 0;
                while (cursor.moveToNext() && n < MAX_CONTACTS) {
                    String name = cursor.getString(nameIdx);
                    String num = cursor.getString(numIdx);
                    if (name == null || num == null) continue;
                    JSObject item = new JSObject();
                    item.put("name", name.trim());
                    item.put("phone", num.trim());
                    out.put(item);
                    n++;
                }
            }
        } catch (Exception e) {
            call.reject("Ошибка чтения контактов: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) cursor.close();
        }
        JSObject res = new JSObject();
        res.put("contacts", out);
        call.resolve(res);
    }
}
