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
page { background: #f6f8fb; color: #162033; font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif; }
/* Native inputs have a small platform default height. Keep their text area
   visible even when a page adds padding inside a border-box field. */
input { box-sizing: border-box; height: 88rpx; min-height: 88rpx; }
</style>

