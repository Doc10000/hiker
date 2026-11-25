package kz.hiker.app;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HikerNative.class);
        super.onCreate(savedInstanceState);

        // Системная кнопка «назад» (кнопка/жест Android) → стек навигации приложения.
        // JS возвращает '1', если обработал; иначе выходим из приложения.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "(function(){try{return (window.__nativeBack&&window.__nativeBack())?'1':'0';}catch(e){return '0';}})()",
                        value -> {
                            if (!"\"1\"".equals(value)) {
                                finish();
                            }
                        }
                    );
                } else {
                    finish();
                }
            }
        });
    }
}
