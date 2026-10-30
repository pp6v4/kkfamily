<script lang="ts">
/**
 * uni-app application lifecycle hooks must be exported from the application
 * options object. Calling `onLaunch` directly here leaves it undefined in the
 * WeChat runtime and prevents the mini program from mounting.
 */
export default {
  onLaunch() {
    console.info('扣扣的家已启动');
  },
};
</script>

<style>
page { --home-bg:#f7f6ef; --home-ink:#34453b; --home-primary:#38674f; --home-muted:#667267; background:var(--home-bg); color:var(--home-ink); font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif; font-size:14px; line-height:1.55; }
/* Native inputs have a small platform default height. Keep their text area
   visible even when a page adds padding inside a border-box field. */
input { box-sizing: border-box; height: 88rpx; min-height: 88rpx; }
</style>
