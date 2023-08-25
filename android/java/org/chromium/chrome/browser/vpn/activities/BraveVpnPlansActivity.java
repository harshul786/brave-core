/**
 * Copyright (c) 2021 The Brave Authors. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

package org.chromium.chrome.browser.vpn.activities;

import android.graphics.Paint;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.ActionBar;
import androidx.appcompat.widget.Toolbar;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.viewpager.widget.ViewPager;

import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.SkuDetails;
import com.google.android.material.tabs.TabLayout;

import org.chromium.base.Log;
import org.chromium.chrome.R;
import org.chromium.chrome.browser.firstrun.BraveFirstRunFlowSequencer;
import org.chromium.chrome.browser.util.BraveConstants;
import org.chromium.chrome.browser.util.LiveDataUtil;
import org.chromium.chrome.browser.vpn.BraveVpnNativeWorker;
import org.chromium.chrome.browser.vpn.adapters.BraveVpnPlanPagerAdapter;
import org.chromium.chrome.browser.vpn.utils.BraveVpnUtils;
import org.chromium.chrome.browser.vpn.utils.InAppPurchaseWrapper;

import java.util.Map;

public class BraveVpnPlansActivity extends BraveVpnParentActivity {
    private BraveFirstRunFlowSequencer mFirstRunFlowSequencer;
    private ProgressBar mMonthlyPlanProgress;
    private ProgressBar mYearlyPlanProgress;
    private LinearLayout mPlanLayout;
    private boolean mShouldShowRestoreMenu;

    private LinearLayout mMonthlySelectorLayout;
    private TextView mMonthlySubscriptionAmountText;

    private LinearLayout mYearlySelectorLayout;
    private TextView mYearlySubscriptionAmountText;

    private MutableLiveData<Boolean> _billingConnectionState = new MutableLiveData();
    private LiveData<Boolean> billingConnectionState = _billingConnectionState;

    @Override
    public void onResumeWithNative() {
        super.onResumeWithNative();
        BraveVpnNativeWorker.getInstance().addObserver(this);
        BraveVpnUtils.dismissProgressDialog();
    }

    @Override
    public void onPauseWithNative() {
        BraveVpnNativeWorker.getInstance().removeObserver(this);
        super.onPauseWithNative();
    }

    private void initializeViews() {
        setContentView(R.layout.activity_brave_vpn_plan);

        Toolbar toolbar = findViewById(R.id.toolbar);
        setSupportActionBar(toolbar);
        ActionBar actionBar = getSupportActionBar();
        assert actionBar != null;
        actionBar.setDisplayHomeAsUpEnabled(true);
        actionBar.setHomeAsUpIndicator(R.drawable.ic_baseline_close_24);
        actionBar.setTitle(getResources().getString(R.string.brave_vpn));

        mMonthlyPlanProgress = findViewById(R.id.monthly_plan_progress);
        mYearlyPlanProgress = findViewById(R.id.yearly_plan_progress);
        mPlanLayout = findViewById(R.id.plan_layout);

        ViewPager braveRewardsViewPager = findViewById(R.id.brave_rewards_view_pager);

        BraveVpnPlanPagerAdapter braveVpnPlanPagerAdapter = new BraveVpnPlanPagerAdapter(this);
        braveRewardsViewPager.setAdapter(braveVpnPlanPagerAdapter);
        TabLayout braveRewardsTabLayout = findViewById(R.id.brave_rewards_tab_layout);
        braveRewardsTabLayout.setupWithViewPager(braveRewardsViewPager, true);

        TextView removedValueText = findViewById(R.id.removed_value_tv);
        removedValueText.setPaintFlags(
                removedValueText.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);

        TextView monthlySubscriptionText = findViewById(R.id.monthly_subscription_text);
        monthlySubscriptionText.setText(
                String.format(getResources().getString(R.string.monthly_subscription), ""));
        mMonthlySubscriptionAmountText = findViewById(R.id.monthly_subscription_amount_text);
        mMonthlySelectorLayout = findViewById(R.id.monthly_selector_layout);

        mYearlySubscriptionAmountText = findViewById(R.id.yearly_subscription_amount_text);
        mYearlySelectorLayout = findViewById(R.id.yearly_selector_layout);
    }

    @Override
    public void finishNativeInitialization() {
        super.finishNativeInitialization();
        InAppPurchaseWrapper.getInstance().startBillingServiceConnection(
                BraveVpnPlansActivity.this, _billingConnectionState);
        LiveDataUtil.observeOnce(billingConnectionState, isConnected -> {
            if (isConnected) {
                // Check for an active subscription to show restore
                BraveVpnUtils.showProgressDialog(BraveVpnPlansActivity.this,
                        getResources().getString(R.string.vpn_connect_text));
                mIsVerification = true;
                verifySubscription();

                // Set up monthly subscription
                mMonthlyPlanProgress.setVisibility(View.VISIBLE);
                InAppPurchaseWrapper.getInstance().queryProductDetailsAsync(
                        InAppPurchaseWrapper.SubscriptionType.MONTHLY,
                        new InAppPurchaseWrapper.QueryProductDetailsResponse() {
                            @Override
                            public void onProductDetails(
                                    Map<String, ProductDetails> productDetailsMap) {
                                ProductDetails monthlyProductDetails = productDetailsMap.get(
                                        InAppPurchaseWrapper.getInstance().getProductId(
                                                InAppPurchaseWrapper.SubscriptionType.MONTHLY));
                                if (monthlyProductDetails != null) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            mMonthlySelectorLayout.setOnClickListener(v
                                                    -> InAppPurchaseWrapper.getInstance()
                                                               .initiatePurchase(
                                                                       BraveVpnPlansActivity.this,
                                                                       monthlyProductDetails));
                                            if (monthlyProductDetails.getSubscriptionOfferDetails()
                                                            != null
                                                    && monthlyProductDetails
                                                               .getSubscriptionOfferDetails()
                                                               .stream()
                                                               .findFirst()
                                                               .isPresent()
                                                    && monthlyProductDetails
                                                               .getSubscriptionOfferDetails()
                                                               .stream()
                                                               .findFirst()
                                                               .get()
                                                               .getPricingPhases()
                                                               .getPricingPhaseList()
                                                               .stream()
                                                               .findFirst()
                                                               .isPresent()) {
                                                String monthlyProductPrice =
                                                        monthlyProductDetails
                                                                .getSubscriptionOfferDetails()
                                                                .stream()
                                                                .findFirst()
                                                                .get()
                                                                .getPricingPhases()
                                                                .getPricingPhaseList()
                                                                .stream()
                                                                .findFirst()
                                                                .get()
                                                                .getFormattedPrice();
                                                mMonthlySubscriptionAmountText.setText(String.format(
                                                        getResources().getString(
                                                                R.string.monthly_subscription_amount),
                                                        monthlyProductPrice));
                                                mMonthlyPlanProgress.setVisibility(View.GONE);
                                            }
                                        }
                                    });
                                }
                            }
                        });

                // Set up yearly subscription
                mYearlyPlanProgress.setVisibility(View.VISIBLE);
                InAppPurchaseWrapper.getInstance().queryProductDetailsAsync(
                        InAppPurchaseWrapper.SubscriptionType.YEARLY,
                        new InAppPurchaseWrapper.QueryProductDetailsResponse() {
                            @Override
                            public void onProductDetails(
                                    Map<String, ProductDetails> productDetailsMap) {
                                ProductDetails yearlyProductDetails = productDetailsMap.get(
                                        InAppPurchaseWrapper.getInstance().getProductId(
                                                InAppPurchaseWrapper.SubscriptionType.YEARLY));
                                if (yearlyProductDetails != null) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            mYearlySelectorLayout.setOnClickListener(v
                                                    -> InAppPurchaseWrapper.getInstance()
                                                               .initiatePurchase(
                                                                       BraveVpnPlansActivity.this,
                                                                       yearlyProductDetails));
                                            if (yearlyProductDetails.getSubscriptionOfferDetails()
                                                            != null
                                                    && yearlyProductDetails
                                                               .getSubscriptionOfferDetails()
                                                               .stream()
                                                               .findFirst()
                                                               .isPresent()
                                                    && yearlyProductDetails
                                                               .getSubscriptionOfferDetails()
                                                               .stream()
                                                               .findFirst()
                                                               .get()
                                                               .getPricingPhases()
                                                               .getPricingPhaseList()
                                                               .stream()
                                                               .findFirst()
                                                               .isPresent()) {
                                                String yearlyProductPrice =
                                                        yearlyProductDetails
                                                                .getSubscriptionOfferDetails()
                                                                .stream()
                                                                .findFirst()
                                                                .get()
                                                                .getPricingPhases()
                                                                .getPricingPhaseList()
                                                                .stream()
                                                                .findFirst()
                                                                .get()
                                                                .getFormattedPrice();
                                                mYearlySubscriptionAmountText.setText(String.format(
                                                        getResources().getString(
                                                                R.string.yearly_subscription_amount),
                                                        yearlyProductPrice));
                                                mYearlyPlanProgress.setVisibility(View.GONE);
                                            }
                                        }
                                    });
                                }
                            }
                        });
            }
        });
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_brave_vpn, menu);
        MenuItem item = menu.findItem(R.id.restore);
        if (mShouldShowRestoreMenu) {
            mShouldShowRestoreMenu = false;
            item.setVisible(true);
            if (mMonthlySelectorLayout != null) {
                mMonthlySelectorLayout.setAlpha(0.4f);
                mMonthlySelectorLayout.setOnClickListener(null);
            }

            if (mYearlySelectorLayout != null) {
                mYearlySelectorLayout.setAlpha(0.4f);
                mYearlySelectorLayout.setOnClickListener(null);
            }
        }
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            finish();
        } else if (item.getItemId() == R.id.restore) {
            BraveVpnUtils.openBraveVpnProfileActivity(BraveVpnPlansActivity.this);
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void triggerLayoutInflation() {
        mFirstRunFlowSequencer = new BraveFirstRunFlowSequencer(this, getProfileSupplier()) {
            @Override
            public void onFlowIsKnown(Bundle freProperties) {
                initializeViews();
            }
        };
        mFirstRunFlowSequencer.start();
        onInitialLayoutInflationComplete();
    }

    @Override
    public boolean shouldStartGpuProcess() {
        return true;
    }

    @Override
    public void showRestoreMenu(boolean shouldShowRestore) {
        this.mShouldShowRestoreMenu = shouldShowRestore;
        invalidateOptionsMenu();
    }

    @Override
    public void updateProfileView() {}
}
