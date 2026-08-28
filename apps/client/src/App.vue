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
</style>

